require("dotenv").config();
const express = require("express");
const axios = require("axios");
const NodeCache = require("node-cache");
const app = express();
const cors = require("cors");
app.use(cors());
const PORT = process.env.PORT || 4000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

// Create an axios instance for GitHub API requests
const github = axios.create({
  baseURL: "https://api.github.com",
  headers: GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {},
  timeout: 30000,
});

// Create cache instance
const cache = new NodeCache({ stdTTL: 60 * 5 });

// Fetch branches for a repository 
async function fetchBranches(owner, repo) {
  const res = await github.get(`/repos/${owner}/${repo}/branches`);
  return res.data;
}

// Ensure all parent commits are fetched for the given commits
async function ensureParents(initialCommits, owner, repo, maxFetch = 1000) {
  const seen = new Map(initialCommits.map((c) => [c.sha, c]));
  const queue = [...initialCommits];
  let fetched = 0;

  // Set variable that collects parent SHAs, checks which ones we actually need to fetch + automatically avoids duplicates
  const missingParents = new Set();

  // Fetch missing parent SHAs in batches to avoid recursion and excessive API calls
  for (const c of initialCommits) {
    if (Array.isArray(c.parents)) {
      for (const p of c.parents) {
        if (p?.sha && !seen.has(p.sha)) {
          missingParents.add(p.sha);
        }
      }
    }
  }

  // Limit the pool of parents to avoid timeout
  const parentsToFetch = Array.from(missingParents).slice(0, Math.min(maxFetch, 200));

  // Fetch parent SHAs in batches
  const batchSize = 10;
  for (let i = 0; i < parentsToFetch.length; i += batchSize) {
    const batch = parentsToFetch.slice(i, i + batchSize);
    const promises = batch.map(async (sha) => {
      try {
        const res = await github.get(`/repos/${owner}/${repo}/commits/${sha}`);
        return res.data;
      } catch (err) {
        console.warn(`Failed to fetch parent ${sha}`);
        return null;
      }
    });

    const results = await Promise.all(promises);
    // Check commit exists and isn't a duplicate before adding
    results.forEach((commit) => {
      if (commit && !seen.has(commit.sha)) {
        seen.set(commit.sha, commit);
        fetched++;
      }
    });

    if (fetched >= maxFetch) break;
  }

  return Array.from(seen.values());
}

// Build graph structure from commit list
function buildGraphFromCommits(commits, commitToBranches = new Map()) {
  const nodesBySha = new Map();
  const links = [];

  // Get branches for each commit and create nodes
  for (const c of commits) {
    const sha = c.sha;
    const branches = commitToBranches.has(sha)
      ? Array.from(commitToBranches.get(sha))
      : [];

    // Create node object
    nodesBySha.set(sha, {
      id: sha,
      author: (c.commit?.author?.name) || (c.author?.login) || "",
      message: (c.commit?.message) || "",
      date: (c.commit?.author?.date) || "",
      branches: branches,
      parentShas: c.parents?.map(p => p.sha) || [],
      childShas: []
    });
  }

  // Build parent-child relationships
  for (const c of commits) {
    const childSha = c.sha;
    const childNode = nodesBySha.get(childSha);

    // Link from parent to child
    if (Array.isArray(c.parents)) {
      for (const p of c.parents) {
        const parentSha = p.sha;

        // Ensure parent node exists; create placeholder node if "missing"
        // This is essential for parent SHAs outside the fetch window
        if (!nodesBySha.has(parentSha)) {
          const inheritedBranches = childNode?.branches || [];
          nodesBySha.set(parentSha, {
            id: parentSha,
            author: "",
            message: "(parent)",
            date: "",
            branches: inheritedBranches,
            parentShas: [],
            childShas: []
          });
        }

        // Add child to parent's childSHAs
        const parentNode = nodesBySha.get(parentSha);
        if (!parentNode.childShas.includes(childSha)) {
          parentNode.childShas.push(childSha);
        }

        // Create directed edge from child to parent
        links.push({ source: childSha, target: parentSha });
      }
    }
  }

  const visited = new Set();

  // Copy branch info from children to parents
  function propagateBranchInfo(sha, branches) {
    if (visited.has(sha) || branches.length === 0) return;
    visited.add(sha);

    const node = nodesBySha.get(sha);
    if (!node) return;

    // Merge new branchs with existing ones to prevent duplicates
    const existingBranches = new Set(node.branches || []);
    for (const branch of branches) {
      existingBranches.add(branch);
    }
    node.branches = Array.from(existingBranches);

    // Recurse to parents
    for (const parentSha of node.parentShas || []) {
      propagateBranchInfo(parentSha, branches);
    }
  }

  // Propagate from commits we know are on branches
  for (const [sha, node] of nodesBySha) {
    if (node.branches && node.branches.length > 0) {
      propagateBranchInfo(sha, node.branches);
    }
  }

  // Set merge/split flags
  for (const node of nodesBySha.values()) {
    node.isMerge = (node.parentShas?.length || 0) > 1;
    node.isSplit = (node.childShas?.length || 0) > 1;
  }

  // Convert map to array
  const nodes = Array.from(nodesBySha.values());
  return { nodes, links };
}

// API endpoint to get graph data
app.get("/api/graph/:owner/:repo", async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const maxCommits = parseInt(req.query.maxCommits || "300", 10);

    // Check cache first 
    const cacheKey = `${owner}/${repo}/${maxCommits}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const branches = await fetchBranches(owner, repo);

    // Fetch default branch name (name may differ repo to repo)
    async function fetchDefaultBranch() {
      try {
        const repoData = await github.get(`/repos/${owner}/${repo}`);
        return repoData.data.default_branch;
      } catch (e) {
        return null;
      }
    }

    // Get latest commit date for each branch
    async function getBranchLatestCommitDate(branchName) {
      try {
        const r = await github.get(`/repos/${owner}/${repo}/commits`, {
          params: { sha: branchName, per_page: 1 },
        });
        const commit = r.data && r.data[0];
        return commit ? (commit.commit?.author?.date) || null : null;
      } catch (e) {
        return null;
      }
    }

    // Fetch branch info for all branches in parallel
    const defaultBranch = await fetchDefaultBranch();
    const branchInfos = await Promise.all(
      branches.map(async (b) => {
        const name = b.name;
        const latestDate = await getBranchLatestCommitDate(name);
        return { name, latestDate };
      })
    );

    // Sort branches by latest commit date (most recent first)
    branchInfos.sort((a, b) => {
      if (!a.latestDate && !b.latestDate) return 0;
      if (!a.latestDate) return 1;
      if (!b.latestDate) return -1;
      return new Date(b.latestDate) - new Date(a.latestDate);
    });

    // Ensure default branch is first, regardless of date
    if (defaultBranch) {
      const idx = branchInfos.findIndex((x) => x.name === defaultBranch);
      if (idx >= 0) {
        const [df] = branchInfos.splice(idx, 1);
        branchInfos.unshift(df);
      } else {
        branchInfos.unshift({ name: defaultBranch, latestDate: null });
      }
    }

    const MAX_BRANCHES = 5;
    const selectedBranchInfos = branchInfos.slice(0, MAX_BRANCHES);
    const branchTips = selectedBranchInfos.map((b) => b.name);

    // Initialize data structures for collecting commits
    const allCommits = [];
    const seen = new Set();
    const commitToBranches = new Map();
    const perBranchCounts = {};

    // Calculate fair quota per branch
    const commitsPerBranch = Math.floor(maxCommits / branchTips.length);
    const extraCommits = maxCommits % branchTips.length;
    let remainingGlobalCommits = maxCommits;

    console.log(`Fair distribution: ${commitsPerBranch} commits per branch (${branchTips.length} branches)`);
    if (extraCommits > 0) {
      console.log(`Extra ${extraCommits} commits will be distributed to first branches`);
    }

    // Process each branch with its quota
    for (let branchIndex = 0; branchIndex < branchTips.length; branchIndex++) {
      const branchName = branchTips[branchIndex];
      
      // Calculate this branch's quota
      const branchQuota = commitsPerBranch + (branchIndex < extraCommits ? 1 : 0);
      
      perBranchCounts[branchName] = 0;
      // Track unique commits for this branch
      let branchCommitCount = 0;
      let page = 1;
      let branchSawExistingSHA = false;

      console.log(`\nFetching branch '${branchName}' (quota: ${branchQuota} unique commits)...`);

      while (true) {
        // Check branch-specific quota first
        if (branchCommitCount >= branchQuota) {
          console.log(`  Branch quota reached (${branchCommitCount}/${branchQuota})`);
          break;
        }
        
        // Ensure global quota is not exceeded
        if (remainingGlobalCommits <= 0) {
          console.log(`  Global quota exhausted`);
          break;
        }

        // Fetch commits for the branch (paginated)
        const res = await github.get(`/repos/${owner}/${repo}/commits`, {
          params: { sha: branchName, per_page: 100, page },
        });
        const pageData = res.data;
        if (!pageData || pageData.length === 0) break;

        // Track which branches each commit belongs to
        for (const c of pageData) {
          const sha = c.sha;
          const alreadySeen = seen.has(sha);

          // Record which branches this commit belongs to (even if commit was already seen from another branch)
          const existingSet = commitToBranches.get(sha) || new Set();
          existingSet.add(branchName);
          commitToBranches.set(sha, existingSet);

          // Only count new commits toward quotas
          if (!alreadySeen) {
            // Check if we can still add commits
            if (branchCommitCount < branchQuota && remainingGlobalCommits > 0) {
              seen.add(sha);
              allCommits.push(c);
              perBranchCounts[branchName] += 1;
              branchCommitCount++; 
              remainingGlobalCommits--; 
            }
          } else {
            branchSawExistingSHA = true;
          }

          // Stop this branch if quota reached
          if (branchCommitCount >= branchQuota) {
            break;
          }
          
          if (remainingGlobalCommits <= 0) {
            break;
          }
        }

        // Stop pagination if we hit our quota or shared history
        if (branchCommitCount >= branchQuota) {
          break;
        }
        
        if (branchSawExistingSHA) {
          console.log(`  Reached shared history with previous branches`);
          break;
        }
        
        // Stop if fewer than 100 commits were returned (no more pages)
        if (pageData.length < 100) {
          console.log(`  No more commits available`);
          break;
        }
        
        page += 1;
      }

      console.log(`  Final count for '${branchName}': ${branchCommitCount} unique commits`);
    }

    console.log(`\nTotal commits collected: ${allCommits.length}`);
    console.log(`Remaining global quota: ${remainingGlobalCommits}`);

    // Deduplicate commits by SHA
    const uniqueBySha = new Map();
    for (const c of allCommits) uniqueBySha.set(c.sha, c);
    const uniqueCommits = Array.from(uniqueBySha.values());

    // Ensure all parent commits are included
    const MAX_PARENT_FETCH = 200;
    const expandedCommits = await ensureParents(uniqueCommits, owner, repo, MAX_PARENT_FETCH);

    const graph = buildGraphFromCommits(expandedCommits, commitToBranches);

    const stats = {
      totalCommits: graph.nodes.length,
      pullRequests: graph.nodes.filter(n => n.isMerge).length,
      splitCommits: graph.nodes.filter(n => n.isSplit).length,
      authors: [...new Set(graph.nodes.map(n => n.author).filter(Boolean))].length,
      branchCounts: {},
    };

    // Count commits per branch in the final graph
    for (const branch of branchTips) {
      stats.branchCounts[branch] = graph.nodes.filter(n => n.branches?.includes(branch)).length;
    }

    // Build response payload, send as JSON
    const payload = {
      meta: {
        owner,
        repo,
        defaultBranch,
        fetchedBranches: branchTips.length,
        commits: uniqueCommits.length,
        selectedBranches: branchTips,
        perBranchCounts,
        stats,
      },
      graph,
    };

    cache.set(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error("API Error:", err?.response?.data || err);

    let errorMessage = "Failed to fetch graph";
    let details = err?.message;

    if (err?.response) {
      const status = err.response.status;
      if (status === 404) {
        errorMessage = "Repository not found";
        details = "Please check the username and repository name";
      } else if (status === 403) {
        errorMessage = "GitHub API rate limit exceeded";
        details = "Please add a GITHUB_TOKEN to your .env file or wait an hour";
      } else if (status === 401) {
        errorMessage = "GitHub authentication failed";
        details = "Check your GITHUB_TOKEN in .env file";
      }
    } else if (err?.code === 'ECONNABORTED') {
      errorMessage = "Request timed out";
      details = "This repository might be too large. Try reducing maxCommits or use a smaller repo.";
    }

    return res.status(err?.response?.status || 500).json({
      error: errorMessage,
      details: details
    });
  }
});

// Start the server
app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
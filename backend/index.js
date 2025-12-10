require("dotenv").config();
const express = require("express");
const axios = require("axios");
const NodeCache = require("node-cache");

const app = express();
const cors = require("cors");
app.use(cors());
const PORT = process.env.PORT || 4000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

const github = axios.create({
  baseURL: "https://api.github.com",
  headers: GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {},
  timeout: 30000,
});

const cache = new NodeCache({ stdTTL: 60 * 5 });

async function fetchBranches(owner, repo) {
  const res = await github.get(`/repos/${owner}/${repo}/branches`);
  return res.data;
}

async function ensureParents(initialCommits, owner, repo, maxFetch = 1000) {
  const seen = new Map(initialCommits.map((c) => [c.sha, c]));
  const queue = [...initialCommits];
  let fetched = 0;
  
  // Batch parent SHAs to check which ones we actually need to fetch
  const missingParents = new Set();
  
  for (const c of initialCommits) {
    if (Array.isArray(c.parents)) {
      for (const p of c.parents) {
        if (p?.sha && !seen.has(p.sha)) {
          missingParents.add(p.sha);
        }
      }
    }
  }
  
  console.log(`Found ${missingParents.size} missing parents to fetch`);
  
  // Limit the pool of parents to avoid timeout
  const parentsToFetch = Array.from(missingParents).slice(0, Math.min(maxFetch, 200));
  
  // Fetch missing parents
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
    results.forEach((commit) => {
      if (commit && !seen.has(commit.sha)) {
        seen.set(commit.sha, commit);
        fetched++;
      }
    });
    
    if (fetched >= maxFetch) break;
  }
  
  console.log(`Fetched ${fetched} parent commits`);
  return Array.from(seen.values());
}

function buildGraphFromCommits(commits, commitToBranches = new Map()) {
  const nodesBySha = new Map();
  const links = [];

  // Create the nodes
  for (const c of commits) {
    const sha = c.sha;
    const branches = commitToBranches.has(sha) 
      ? Array.from(commitToBranches.get(sha))
      : [];
    
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

  // Create node links and childShas
  for (const c of commits) {
    const childSha = c.sha;
    const childNode = nodesBySha.get(childSha);
    
    if (Array.isArray(c.parents)) {
      for (const p of c.parents) {
        const parentSha = p.sha;
        
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
        
        const parentNode = nodesBySha.get(parentSha);
        if (!parentNode.childShas.includes(childSha)) {
          parentNode.childShas.push(childSha);
        }
        
        // Links from child to parent
        links.push({ source: childSha, target: parentSha });
      }
    }
  }

  // Propagate branch info up the parent chain
  const visited = new Set();
  
  function propagateBranchInfo(sha, branches) {
    if (visited.has(sha) || branches.length === 0) return;
    visited.add(sha);
    
    const node = nodesBySha.get(sha);
    if (!node) return;
    
    const existingBranches = new Set(node.branches || []);
    for (const branch of branches) {
      existingBranches.add(branch);
    }
    node.branches = Array.from(existingBranches);
    
    for (const parentSha of node.parentShas || []) {
      propagateBranchInfo(parentSha, branches);
    }
  }
  
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

  const nodes = Array.from(nodesBySha.values());
  return { nodes, links };
}

app.get("/api/graph/:owner/:repo", async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const maxCommits = parseInt(req.query.maxCommits || "300", 10);

    const cacheKey = `${owner}/${repo}/${maxCommits}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const branches = await fetchBranches(owner, repo);

    async function fetchDefaultBranch() {
      try {
        const repoData = await github.get(`/repos/${owner}/${repo}`);
        return repoData.data.default_branch;
      } catch (e) {
        return null;
      }
    }

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

    const defaultBranch = await fetchDefaultBranch();
    const branchInfos = await Promise.all(
      branches.map(async (b) => {
        const name = b.name;
        const latestDate = await getBranchLatestCommitDate(name);
        return { name, latestDate };
      })
    );

    branchInfos.sort((a, b) => {
      if (!a.latestDate && !b.latestDate) return 0;
      if (!a.latestDate) return 1;
      if (!b.latestDate) return -1;
      return new Date(b.latestDate) - new Date(a.latestDate);
    });

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

    console.log("Selected branches:", branchTips.join(", "));

    const allCommits = [];
    const seen = new Set();
    const commitToBranches = new Map();
    const perBranchCounts = {};

    for (const branchName of branchTips) {
      perBranchCounts[branchName] = 0;
      let page = 1;
      let branchSawExistingSHA = false;
      
      while (true) {
        if (allCommits.length >= maxCommits) break;

        const res = await github.get(`/repos/${owner}/${repo}/commits`, {
          params: { sha: branchName, per_page: 100, page },
        });
        const pageData = res.data;
        if (!pageData || pageData.length === 0) break;

        for (const c of pageData) {
          const sha = c.sha;
          const alreadySeen = seen.has(sha);

          const existingSet = commitToBranches.get(sha) || new Set();
          existingSet.add(branchName);
          commitToBranches.set(sha, existingSet);

          if (!alreadySeen) {
            seen.add(sha);
            allCommits.push(c);
            perBranchCounts[branchName] += 1;
          } else {
            branchSawExistingSHA = true;
          }

          if (allCommits.length >= maxCommits) break;
        }

        if (branchSawExistingSHA || pageData.length < 100) break;
        page += 1;
      }

      console.log(`Branch ${branchName}: ${perBranchCounts[branchName]} unique commits`);
      if (allCommits.length >= maxCommits) break;
    }

    console.log(`Total commits collected: ${allCommits.length}`);

    const uniqueBySha = new Map();
    for (const c of allCommits) uniqueBySha.set(c.sha, c);
    const uniqueCommits = Array.from(uniqueBySha.values());

    console.log("Expanding parent chains...");
    const MAX_PARENT_FETCH = 200; // Reduced from 1000 to speed up
    const expandedCommits = await ensureParents(uniqueCommits, owner, repo, MAX_PARENT_FETCH);
    
    console.log("Building graph structure...");
    const graph = buildGraphFromCommits(expandedCommits, commitToBranches);

    const stats = {
      totalCommits: graph.nodes.length,
      pullRequests: graph.nodes.filter(n => n.isMerge).length,
      splitCommits: graph.nodes.filter(n => n.isSplit).length,
      authors: [...new Set(graph.nodes.map(n => n.author).filter(Boolean))].length,
      branchCounts: {},
    };

    for (const branch of branchTips) {
      stats.branchCounts[branch] = graph.nodes.filter(n => n.branches?.includes(branch)).length;
    }

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

app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
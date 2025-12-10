// Run with: node unit-test.js
// Prereqs: npm install node-fetch@2

const fetch = require('node-fetch');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

class GraphAccuracyTests {
  constructor(apiUrl = 'http://localhost:4000') {
    this.apiUrl = apiUrl;
    this.passed = 0;
    this.failed = 0;
    this.warnings = 0;
  }

  assert(condition, testName, errorMsg = '') {
    if (condition) {
      this.passed++;
      log('green', `✓ ${testName}`);
      return true;
    } else {
      this.failed++;
      log('red', `✗ ${testName}`);
      if (errorMsg) log('red', `  → ${errorMsg}`);
      return false;
    }
  }

  warn(message) {
    this.warnings++;
    log('yellow', `⚠ ${message}`);
  }

  async fetchGraph(owner, repo, maxCommits = 300) {
    try {
      const response = await fetch(
        `${this.apiUrl}/api/graph/${owner}/${repo}?maxCommits=${maxCommits}`
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      log('red', `Failed to fetch graph: ${error.message}`);
      return null;
    }
  }

  // === STRUCTURAL INTEGRITY TESTS ===

  testBasicStructure(data) {
    log('cyan', '\n📋 Testing Basic Structure...');

    this.assert(
      data !== null && typeof data === 'object',
      'API returns valid JSON object'
    );

    this.assert(
      data.graph && data.meta,
      'Response contains graph and meta properties',
      `Got: ${Object.keys(data)}`
    );

    this.assert(
      Array.isArray(data.graph.nodes),
      'graph.nodes is an array',
      `Type: ${typeof data.graph.nodes}`
    );

    this.assert(
      Array.isArray(data.graph.links),
      'graph.links is an array',
      `Type: ${typeof data.graph.links}`
    );

    this.assert(
      data.graph.nodes.length > 0,
      'Graph contains nodes',
      `Found ${data.graph.nodes.length} nodes`
    );

    this.assert(
      data.graph.links.length > 0,
      'Graph contains links',
      `Found ${data.graph.links.length} links`
    );
  }

  testNodeStructure(data) {
    log('cyan', '\n📦 Testing Node Structure...');

    const sampleNode = data.graph.nodes[0];
    const requiredFields = ['id', 'author', 'message', 'date', 'branches', 'parentShas', 'childShas'];

    requiredFields.forEach(field => {
      this.assert(
        field in sampleNode,
        `Nodes have '${field}' property`,
        `Sample node: ${JSON.stringify(sampleNode, null, 2)}`
      );
    });

    this.assert(
      typeof sampleNode.id === 'string' && sampleNode.id.length === 40,
      'Node IDs are valid 40-character SHAs',
      `Sample ID: ${sampleNode.id} (length: ${sampleNode.id?.length})`
    );

    this.assert(
      Array.isArray(sampleNode.branches),
      'branches is an array',
      `Type: ${typeof sampleNode.branches}`
    );

    this.assert(
      Array.isArray(sampleNode.parentShas),
      'parentShas is an array',
      `Type: ${typeof sampleNode.parentShas}`
    );

    this.assert(
      Array.isArray(sampleNode.childShas),
      'childShas is an array',
      `Type: ${typeof sampleNode.childShas}`
    );

    this.assert(
      typeof sampleNode.isMerge === 'boolean',
      'isMerge is a boolean',
      `Type: ${typeof sampleNode.isMerge}`
    );

    this.assert(
      typeof sampleNode.isSplit === 'boolean',
      'isSplit is a boolean',
      `Type: ${typeof sampleNode.isSplit}`
    );
  }

  testLinkIntegrity(data) {
    log('cyan', '\n🔗 Testing Link Integrity...');

    const nodeIds = new Set(data.graph.nodes.map(n => n.id));
    const brokenLinks = [];

    data.graph.links.forEach((link, idx) => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;

      if (!nodeIds.has(sourceId)) {
        brokenLinks.push({ idx, issue: 'source', id: sourceId });
      }
      if (!nodeIds.has(targetId)) {
        brokenLinks.push({ idx, issue: 'target', id: targetId });
      }
    });

    this.assert(
      brokenLinks.length === 0,
      'All links reference existing nodes',
      `Found ${brokenLinks.length} broken links: ${JSON.stringify(brokenLinks.slice(0, 3))}`
    );

    // Check for duplicate links
    const linkKeys = new Set();
    const duplicates = [];
    data.graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      const key = `${sourceId}->${targetId}`;
      if (linkKeys.has(key)) {
        duplicates.push(key);
      }
      linkKeys.add(key);
    });

    this.assert(
      duplicates.length === 0,
      'No duplicate links',
      `Found ${duplicates.length} duplicates`
    );
  }

  // === GIT SEMANTICS TESTS ===

  testParentChildRelationships(data) {
    log('cyan', '\n👨‍👧 Testing Parent-Child Relationships...');

    const nodeMap = new Map(data.graph.nodes.map(n => [n.id, n]));
    let inconsistencies = 0;

    data.graph.nodes.forEach(node => {
      // For each parent in parentShas, verify child is in parent's childShas
      node.parentShas?.forEach(parentId => {
        const parent = nodeMap.get(parentId);
        if (parent && !parent.childShas.includes(node.id)) {
          inconsistencies++;
          if (inconsistencies <= 3) {
            log('red', `  Parent ${parentId.substring(0, 7)} doesn't list ${node.id.substring(0, 7)} as child`);
          }
        }
      });

      // For each child in childShas, verify parent is in child's parentShas
      node.childShas?.forEach(childId => {
        const child = nodeMap.get(childId);
        if (child && !child.parentShas.includes(node.id)) {
          inconsistencies++;
          if (inconsistencies <= 3) {
            log('red', `  Child ${childId.substring(0, 7)} doesn't list ${node.id.substring(0, 7)} as parent`);
          }
        }
      });
    });

    this.assert(
      inconsistencies === 0,
      'Parent-child relationships are bidirectional',
      `Found ${inconsistencies} inconsistencies`
    );
  }

  testMergeDetection(data) {
    log('cyan', '\n🔀 Testing Merge Commit Detection...');

    let correctMerges = 0;
    let incorrectMerges = 0;

    data.graph.nodes.forEach(node => {
      const parentCount = node.parentShas?.length || 0;
      const isMarkedMerge = node.isMerge === true;
      const shouldBeMerge = parentCount > 1;

      if (isMarkedMerge === shouldBeMerge) {
        correctMerges++;
      } else {
        incorrectMerges++;
        if (incorrectMerges <= 3) {
          log('red', `  ${node.id.substring(0, 7)}: marked=${isMarkedMerge}, parents=${parentCount}`);
        }
      }
    });

    this.assert(
      incorrectMerges === 0,
      'Merge commits correctly identified (2+ parents)',
      `${incorrectMerges} incorrect, ${correctMerges} correct`
    );

    const mergeCount = data.graph.nodes.filter(n => n.isMerge).length;
    const statsCount = data.meta.stats?.mergeCommits || 0;

    this.assert(
      mergeCount === statsCount,
      'Merge count matches stats',
      `Actual: ${mergeCount}, Stats: ${statsCount}`
    );
  }

  testSplitDetection(data) {
    log('cyan', '\n✂️ Testing Split Point Detection...');

    let correctSplits = 0;
    let incorrectSplits = 0;

    data.graph.nodes.forEach(node => {
      const childCount = node.childShas?.length || 0;
      const isMarkedSplit = node.isSplit === true;
      const shouldBeSplit = childCount > 1;

      if (isMarkedSplit === shouldBeSplit) {
        correctSplits++;
      } else {
        incorrectSplits++;
        if (incorrectSplits <= 3) {
          log('red', `  ${node.id.substring(0, 7)}: marked=${isMarkedSplit}, children=${childCount}`);
        }
      }
    });

    this.assert(
      incorrectSplits === 0,
      'Split points correctly identified (2+ children)',
      `${incorrectSplits} incorrect, ${correctSplits} correct`
    );
  }

  testBranchAssignments(data) {
    log('cyan', '\n🌿 Testing Branch Assignments...');

    const nodesWithoutBranches = data.graph.nodes.filter(n => !n.branches || n.branches.length === 0);

    if (nodesWithoutBranches.length > 0) {
      this.warn(`${nodesWithoutBranches.length} nodes have no branch assignments`);
      log('yellow', `  Sample: ${nodesWithoutBranches.slice(0, 3).map(n => n.id.substring(0, 7)).join(', ')}`);
    }

    const expectedBranches = data.meta.selectedBranches || [];
    const foundBranches = new Set();
    data.graph.nodes.forEach(n => {
      n.branches?.forEach(b => foundBranches.add(b));
    });

    this.assert(
      expectedBranches.every(b => foundBranches.has(b)),
      'All selected branches appear in node assignments',
      `Expected: ${expectedBranches.join(', ')}, Found: ${Array.from(foundBranches).join(', ')}`
    );

    const nodesOnDefaultBranch = data.graph.nodes.filter(n =>
      n.branches?.includes(data.meta.defaultBranch)
    ).length;

    log('blue', `  Default branch (${data.meta.defaultBranch}): ${nodesOnDefaultBranch} commits`);

    this.assert(
      nodesOnDefaultBranch > 0,
      'Default branch has commits assigned',
      `Found ${nodesOnDefaultBranch} commits on ${data.meta.defaultBranch}`
    );
  }

  testLinkDirection(data) {
    log('cyan', '\n➡️ Testing Link Direction (Child → Parent)...');

    const nodeMap = new Map(data.graph.nodes.map(n => [n.id, n]));
    let correctDirections = 0;
    let incorrectDirections = 0;

    data.graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;

      const sourceNode = nodeMap.get(sourceId);
      const targetNode = nodeMap.get(targetId);

      if (!sourceNode || !targetNode) return;

      // Link should go from child to parent, so source should list target in its parentShas
      if (sourceNode.parentShas?.includes(targetId)) {
        correctDirections++;
      } else {
        incorrectDirections++;
        if (incorrectDirections <= 3) {
          log('red', `  Link ${sourceId.substring(0, 7)} → ${targetId.substring(0, 7)} is backwards`);
        }
      }
    });

    this.assert(
      incorrectDirections === 0,
      'All links point from child to parent',
      `${incorrectDirections} backwards, ${correctDirections} correct`
    );
  }

  // === METADATA ACCURACY TESTS ===

  testMetadataAccuracy(data) {
    log('cyan', '\n📊 Testing Metadata Accuracy...');

    this.assert(
      data.meta.defaultBranch && typeof data.meta.defaultBranch === 'string',
      'Default branch is specified',
      `Value: ${data.meta.defaultBranch}`
    );

    this.assert(
      data.meta.selectedBranches && Array.isArray(data.meta.selectedBranches),
      'Selected branches is an array',
      `Type: ${typeof data.meta.selectedBranches}`
    );

    const actualTotal = data.graph.nodes.length;
    const reportedTotal = data.meta.stats?.totalCommits || 0;

    this.assert(
      actualTotal === reportedTotal,
      'Total commits matches actual node count',
      `Actual: ${actualTotal}, Reported: ${reportedTotal}`
    );

    // Verify branch counts
    if (data.meta.stats?.branchCounts) {
      Object.entries(data.meta.stats.branchCounts).forEach(([branch, count]) => {
        const actual = data.graph.nodes.filter(n => n.branches?.includes(branch)).length;
        this.assert(
          actual === count,
          `Branch '${branch}' count is accurate`,
          `Actual: ${actual}, Reported: ${count}`
        );
      });
    }
  }

  testAuthorTracking(data) {
    log('cyan', '\n👥 Testing Author Tracking...');

    const uniqueAuthors = new Set(
      data.graph.nodes
        .map(n => n.author)
        .filter(a => a && a !== '')
    );

    const reportedAuthors = data.meta.stats?.authors || 0;

    this.assert(
      uniqueAuthors.size === reportedAuthors,
      'Author count matches unique authors',
      `Actual: ${uniqueAuthors.size}, Reported: ${reportedAuthors}`
    );

    log('blue', `  Authors: ${Array.from(uniqueAuthors).slice(0, 5).join(', ')}${uniqueAuthors.size > 5 ? '...' : ''}`);
  }

  // === GRAPH TOPOLOGY TESTS ===

  testGraphConnectivity(data) {
    log('cyan', '\n🕸️ Testing Graph Connectivity...');

    // Build adjacency list
    const adjacency = new Map();
    data.graph.nodes.forEach(n => adjacency.set(n.id, []));

    data.graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;

      if (!adjacency.has(sourceId)) adjacency.set(sourceId, []);
      adjacency.get(sourceId).push(targetId);

      if (!adjacency.has(targetId)) adjacency.set(targetId, []);
      adjacency.get(targetId).push(sourceId);
    });

    // BFS to find connected components
    const visited = new Set();
    const components = [];

    for (const nodeId of data.graph.nodes.map(n => n.id)) {
      if (visited.has(nodeId)) continue;

      const component = [];
      const queue = [nodeId];
      visited.add(nodeId);

      while (queue.length > 0) {
        const current = queue.shift();
        component.push(current);

        const neighbors = adjacency.get(current) || [];
        neighbors.forEach(neighbor => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }

      components.push(component);
    }

    if (components.length > 1) {
      this.warn(`Graph has ${components.length} disconnected components`);
      components.forEach((comp, idx) => {
        log('yellow', `  Component ${idx + 1}: ${comp.length} nodes`);
      });
    } else {
      this.assert(
        components.length === 1,
        'Graph is fully connected',
        `Found ${components.length} component(s)`
      );
    }
  }

  testForCycles(data) {
    log('cyan', '\n🔄 Testing for Cycles (Git DAG should be acyclic)...');

    const nodeMap = new Map(data.graph.nodes.map(n => [n.id, n]));
    const visited = new Set();
    const recursionStack = new Set();
    let cycleFound = false;

    function hasCycle(nodeId) {
      if (recursionStack.has(nodeId)) {
        cycleFound = true;
        return true;
      }
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (node && node.parentShas) {
        for (const parentId of node.parentShas) {
          if (hasCycle(parentId)) return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    }

    for (const node of data.graph.nodes) {
      if (!visited.has(node.id)) {
        if (hasCycle(node.id)) break;
      }
    }

    this.assert(
      !cycleFound,
      'Graph is acyclic (no cycles detected)',
      cycleFound ? 'Cycle detected - this violates Git DAG structure!' : ''
    );
  }


  // === RUN TESTS ===

  async runAllTests(owner, repo, maxCommits = 300) {
    log('blue', `\n${'='.repeat(60)}`);
    log('blue', `🧪 TESTING: ${owner}/${repo} (maxCommits: ${maxCommits})`);
    log('blue', `${'='.repeat(60)}`);

    const data = await this.fetchGraph(owner, repo, maxCommits);
    if (!data) {
      log('red', 'Failed to fetch graph data. Aborting tests.');
      return;
    }

    this.testBasicStructure(data);
    this.testNodeStructure(data);
    this.testLinkIntegrity(data);
    this.testParentChildRelationships(data);
    this.testMergeDetection(data);
    this.testSplitDetection(data);
    this.testBranchAssignments(data);
    this.testLinkDirection(data);
    this.testMetadataAccuracy(data);
    this.testAuthorTracking(data);
    this.testGraphConnectivity(data);
    this.testForCycles(data);

    log('blue', `\n${'='.repeat(60)}`);
    log('green', `✓ Passed: ${this.passed}`);
    if (this.failed > 0) log('red', `✗ Failed: ${this.failed}`);
    if (this.warnings > 0) log('yellow', `⚠ Warnings: ${this.warnings}`);
    log('blue', `${'='.repeat(60)}\n`);

    return {
      passed: this.passed,
      failed: this.failed,
      warnings: this.warnings,
      success: this.failed === 0
    };
  }
}


async function main() {
  const tester = new GraphAccuracyTests();

  // Test multiple repositories
  const repos = [
    { owner: 'meiganlu', repo: 'study-spotter', maxCommits: 100 },
    { owner: 'vercel', repo: 'next.js', maxCommits: 300 },
  ];

  for (const { owner, repo, maxCommits } of repos) {
    await tester.runAllTests(owner, repo, maxCommits);

    // Reset the counters for next test
    tester.passed = 0;
    tester.failed = 0;
    tester.warnings = 0;
  }
}

main().catch(console.error);
import React, { useState } from "react";
import RepoGraph from "./components/RepoGraph";

function App() {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [graph, setGraph] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<any>(null);
  const [visibleBranches, setVisibleBranches] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [loadingStatus, setLoadingStatus] = useState<string>("");

  // Fetch graph data from backend
  const fetchGraph = async () => {
    if (!owner || !repo) {
      setError("Please enter both username and repository name");
      return;
    }

    setLoading(true);
    setError("");
    setLoadingStatus("Fetching repository data...");

    try {
      // Set a 30s timeout for the fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      // Use browser's fetch API to call backend endpoint
      const res = await fetch(
        `http://localhost:4000/api/graph/${owner}/${repo}?maxCommits=300`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
      }

      setLoadingStatus("Processing graph data...");
      const data = await res.json();

      if (data.error) {
        setError(data.error + (data.details ? `: ${data.details}` : ""));
        return;
      }

      // Update state with fetched graph data
      setGraph(data);
      setMeta(data.meta);
      setVisibleBranches(data.meta.selectedBranches);
      setLoadingStatus("");
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          setError("Request timed out. This repository might be too large. Try a smaller repo or increase maxCommits limit.");
        } else {
          setError("Failed to fetch graph: " + err.message);
        }
      } else {
        setError("Failed to fetch graph: Unknown error");
      }
    } finally {
      setLoading(false);
      setLoadingStatus("");
    }
  };

  // Handle Enter key press to trigger fetch
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      fetchGraph();
    }
  };

  return (
    <div style={{ padding: 16, minHeight: "100vh", width: "80%", margin: "0 10%" }}>
      <h1 style={{ marginBottom: 8, color: "#1e1e1e" }}>GITHUB WORKFLOW VISUALIZER</h1>
      <p style={{ color: "#1e1e1e", marginBottom: 16, fontSize: 16 }}>
        Visualize a repository's history from branches, PRs, and commit patterns.
      </p>

      <div style={{
        marginBottom: 16,
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap"
      }}>
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="GitHub username"
          style={{
            padding: "8px 12px",
            borderRadius: 20,
            border: "1px solid #ddd",
            fontSize: 14,
            fontFamily: 'Quicksand'
          }}
        />
        <input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Repository name"
          style={{
            padding: "8px 12px",
            borderRadius: 20,
            border: "1px solid #ddd",
            fontSize: 14,
            fontFamily: 'Quicksand'
          }}
        />
        <button
          onClick={fetchGraph}
          disabled={loading}
          style={{
            padding: "8px 16px",
            borderRadius: 20,
            border: "none",
            background: loading ? "#ccc" : "#949494ff",
            color: "white",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: 14,
            fontWeight: 500,
            fontFamily: 'Quicksand'
          }}
        >
          {loading ? loadingStatus || "Loading..." : "Create Graph"}
        </button>
        {loading && (
          <span style={{ fontSize: 14, color: "#1e1e1e", marginLeft: 8 }}>
            This may take longer for large repositories...
          </span>
        )}
      </div>

      {error && (
        <div style={{
          padding: 12,
          background: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: 20,
          marginBottom: 16,
          color: "#856404"
        }}>
          ⚠️ {error}
        </div>
      )}

      {meta && (
        <>
          <div style={{
            marginBottom: 16,
            padding: 20,
            background: "rgb(217, 217, 217)",
            borderRadius: 20,
            boxShadow: `
              10px 10px 15px rgba(158, 158, 161, 0.5),
              -10px -10px 20px rgba(238, 238, 238, 0.9)
            `,
            border: "none"
          }}>
            <h3 style={{ margin: "0 0 1.5% 0", fontSize: 16, fontWeight: 600 }}>
              Repository Statistics
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, fontSize: 14 }}>
              <div>
                <strong>Total Commits:</strong> {meta.stats?.totalCommits || meta.commits}
              </div>
              <div>
                <strong>Pull Requests:</strong> {meta.stats?.pullRequests || 0}
              </div>
              <div>
                <strong>Split Points:</strong> {meta.stats?.splitCommits || 0}
              </div>
              <div>
                <strong>Contributors:</strong> {meta.stats?.authors || "N/A"}
              </div>
              <div>
                <strong>Branches Shown:</strong> {meta.fetchedBranches}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: "2% 0 1% 0", fontSize: 16, fontWeight: 600, color: "#1e1e1e" }}>
              Filter by Branch
            </h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {meta.selectedBranches.map((branch: string) => {
                const isVisible = visibleBranches.includes(branch);
                const commitCount = meta.stats?.branchCounts?.[branch] || meta.perBranchCounts[branch] || 0;
                const isMain = branch === "main" || branch === "master";

                return (
                  <button
                    key={branch}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 20,
                      border: isVisible ? "2px solid #949494ff" : "1px solid #ddd",
                      background: isVisible ? "#f9fcfeff" : "#fff",
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: isMain ? 600 : 400,
                      fontFamily: 'Quicksand',
                      display: "flex",
                      alignItems: "center",
                      gap: 4
                    }}
                    onClick={() => {
                      setVisibleBranches(prev =>
                        prev.includes(branch)
                          ? prev.filter(b => b !== branch)
                          : [...prev, branch]
                      );
                    }}
                  >
                    <span>{isVisible ? "✓" : "○"}</span>
                    <span>{branch}</span>
                    <span style={{
                      background: "#e1e4e8",
                      padding: "2px 6px",
                      borderRadius: 10,
                      fontSize: 11
                    }}>
                      {commitCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {graph ? (
        <RepoGraph 
          data={graph}
          visibleBranches={visibleBranches} 
        />
      ) : (
        <div style={{
          padding: 40,
          textAlign: "center",
          color: "#949494ff",
          border: "2px dashed #ddd",
          borderRadius: 8,
          background: "#fafafa"
        }}>
          <div style={{ fontSize: 16, fontWeight: 500 }}>No repository loaded</div>
          <div style={{ fontSize: 14, marginTop: 8 }}>
            Enter a GitHub username and repository name above to visualize its history
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
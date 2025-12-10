import React, { useRef, useEffect } from "react";
import * as d3 from "d3";

type NodeDatum = d3.SimulationNodeDatum & {
  id: string;
  author?: string;
  message?: string;
  branches?: string[];
  isMerge?: boolean;
  date?: string;
  parentShas?: string[];
  childShas?: string[];
};

type LinkDatum = d3.SimulationLinkDatum<NodeDatum> & {
  source: string | NodeDatum;
  target: string | NodeDatum;
};

type GraphPayload = {
  meta: {
    defaultBranch?: string;
    owner?: string;
    repo?: string;
    fetchedBranches?: number;
    commits?: number;
    selectedBranches?: string[];
    perBranchCounts?: Record<string, number>;
    stats?: any;
  };
  graph: {
    nodes: NodeDatum[];
    links: LinkDatum[];
  };
};

export const RepoGraph: React.FC<{
  data?: GraphPayload;
  width?: number;
  height?: number;
  visibleBranches?: string[];
}> = ({ data, width = 800, height = 400, visibleBranches }) => {

  console.log("📊 RepoGraph data:", data);
  console.log("📊 Graph nodes:", data?.graph?.nodes?.length);
  console.log("📊 Graph links:", data?.graph?.links?.length);
  console.log("📊 Visible branches:", visibleBranches);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Extract graph data for useEffect to reference them
  const graph = data?.graph;
  const meta = data?.meta;
  const defaultBranch = meta?.defaultBranch;

  // Create the graph
  useEffect(() => {
    // Run early guard inside the effect
    if (!svgRef.current) return;
    console.log("RepoGraph received data:", data); // TODO: DELETE LATER
    if (!graph) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Local copies
    let nodes = graph.nodes.slice();
    let links = graph.links.slice();

    // Filter by visibleBranches but still include ancestors
    if (visibleBranches && visibleBranches.length > 0) {
      const directlyVisible = new Set(
        graph.nodes
          .filter((n) => n.branches?.some((b) => visibleBranches.includes(b)))
          .map((n) => n.id)
      );

      const nodesToInclude = new Set(directlyVisible);
      const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

      const includeAncestors = (nodeId: string): void => {
        const node = nodeMap.get(nodeId);
        if (!node) return;
        for (const parentId of node.parentShas || []) {
          if (!nodesToInclude.has(parentId)) {
            nodesToInclude.add(parentId);
            includeAncestors(parentId);
          }
        }
      };

      directlyVisible.forEach(id => includeAncestors(id));

      nodes = graph.nodes.filter(n => nodesToInclude.has(n.id));
      links = graph.links.filter(l => {
        const sourceId = typeof l.source === "string" ? l.source : (l.source as NodeDatum).id;
        const targetId = typeof l.target === "string" ? l.target : (l.target as NodeDatum).id;
        return nodesToInclude.has(sourceId) && nodesToInclude.has(targetId);
      });
    }

    const g = svg.append("g");

    // Allow for zooming and panning
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 5])
        .on("zoom", (event) => g.attr("transform", event.transform))
    );

    // Form topological layout (parents are lower)
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const layers = new Map<string, number>();
    const visited = new Set<string>();

    const getLayer = (nodeId: string): number => {
      if (layers.has(nodeId)) return layers.get(nodeId)!;
      if (visited.has(nodeId)) return 0;
      visited.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return 0;
      if (!node.childShas || node.childShas.length === 0) {
        layers.set(nodeId, 0);
        return 0;
      }
      const childLayers = node.childShas.map(childId => getLayer(childId));
      const layer = Math.max(...childLayers) + 1;
      layers.set(nodeId, layer);
      return layer;
    };

    nodes.forEach(n => getLayer(n.id));
    const maxLayer = layers.size ? Math.max(...Array.from(layers.values())) : 0;
    const layerHeight = Math.min(120, height / (maxLayer + 2));

    const nodesByLayer = new Map<number, NodeDatum[]>();
    nodes.forEach(n => {
      const layer = layers.get(n.id) || 0;
      if (!nodesByLayer.has(layer)) nodesByLayer.set(layer, []);
      nodesByLayer.get(layer)!.push(n);
    });

    // Set node initial positions
    nodes.forEach(n => {
      const layer = layers.get(n.id) || 0;
      const nodesInLayer = nodesByLayer.get(layer) || [];
      const indexInLayer = nodesInLayer.indexOf(n);
      const layerWidth = width - 100;
      const spacing = nodesInLayer.length > 1 ? layerWidth / (nodesInLayer.length - 1) : 0;
      n.x = 50 + (nodesInLayer.length === 1 ? layerWidth / 2 : indexInLayer * spacing);
      n.y = height - 50 - (layer * layerHeight);
    });

    const simulation = d3
      .forceSimulation<NodeDatum>(nodes)
      .force(
        "link",
        d3.forceLink<NodeDatum, LinkDatum>(links).id(d => d.id).distance(layerHeight).strength(0.3)
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("collision", d3.forceCollide().radius(35))
      .force("y", d3.forceY((d: any) => {
        const layer = layers.get((d as NodeDatum).id) || 0;
        return height - 50 - (layer * layerHeight);
      }).strength(0.8))
      .force("x", d3.forceX(width / 2).strength(0.02))
      .alpha(0.3)
      .alphaDecay(0.05);

    svg.append("defs").append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 25)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#999");

    // Create links
    const link = g.append("g").attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 2)
      .attr("marker-end", "url(#arrowhead)");

    // Create nodes
    const node = g.append("g").attr("class", "nodes")
  .selectAll("circle")
  .data(nodes)
  .join("circle")
  .attr("r", 20)
  .attr("fill", (d) => {
    if (d.isMerge) return "#f56e0f";
    if (d.branches?.includes(defaultBranch || "")) return "#00b4d8";
    return "#707070ff";
  })
  .attr("stroke", (d) => (d.branches?.includes(defaultBranch || "") ? "#000" : "#666"))
  .attr("stroke-width", 2)
  .style("cursor", "pointer");

(node as d3.Selection<SVGCircleElement, NodeDatum, any, any>)
  .call(
    d3.drag<SVGCircleElement, NodeDatum>()
      .on("start", (event: any, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        (d as any).fx = (d as any).x;
        (d as any).fy = (d as any).y;
      })
      .on("drag", (event: any, d) => {
        (d as any).fx = event.x;
        (d as any).fy = event.y;
      })
      .on("end", (event: any, d) => {
        if (!event.active) simulation.alphaTarget(0);
        (d as any).fx = null;
        (d as any).fy = null;
      })
  );

    const tooltip = d3.select("body")
      .append("div")
      .attr("class", "rv-tooltip")
      .style("position", "absolute")
      .style("pointer-events", "none")
      .style("padding", "8px 12px")
      .style("background", "rgba(0,0,0,0.8)")
      .style("color", "white")
      .style("border-radius", "4px")
      .style("font-size", "12px")
      .style("display", "none")
      .style("z-index", "1000")
      .style("max-width", "300px");

    node.on("mouseover", (event, d) => {
      tooltip.style("display", "block").html(`
        <div style="font-weight:bold;margin-bottom:4px">${d.id}</div>
        ${d.author ? `<div>⟡ Owner: ${d.author}</div>` : ""}
        ${d.message ? `<div>⟡ Commit: ${d.message.substring(0,60)}${d.message.length>60?"...":""}</div>` : ""}
        ${d.branches?.length ? `<div>⟡ Branches: ${d.branches.join(", ")}</div>` : ""}
        ${d.isMerge ? `<div>⟡ Pull request</div>` : ""}
        ${d.date ? `<div>⟡ Date: ${new Date(d.date).toLocaleDateString()}</div>` : ""}
      `);
    }).on("mousemove", (event) => {
      tooltip.style("left", (event as any).pageX + 15 + "px").style("top", (event as any).pageY + 15 + "px");
    }).on("mouseout", () => tooltip.style("display", "none"));

    // Labels 
    const labels = g.append("g").attr("class", "labels")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text(d => d.id.substring(0,8))
      .attr("font-size", 10)
      .attr("font-family", "monospace")
      .attr("fill", "#333")
      .attr("dx", 24)
      .attr("dy", 4);

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as NodeDatum).x ?? 0)
        .attr("y1", (d) => (d.source as NodeDatum).y ?? 0)
        .attr("x2", (d) => (d.target as NodeDatum).x ?? 0)
        .attr("y2", (d) => (d.target as NodeDatum).y ?? 0);

      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);

      labels.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
    });

    // Cleanup
    return () => {
      simulation.stop();
      tooltip.remove();
      svg.selectAll("*").remove();
    };
  }, [data, graph, width, height, visibleBranches, defaultBranch]);

  if (!graph) {
    return <div style={{ color: "white" }}>No graph data available</div>;
  }

  return (
    <div style={{ padding: 8 }}>
      <div style={{ fontSize: 14, marginBottom: 14, color: "#1e1e1e" }}>
        Showing {graph.nodes.length} commits, {graph.links.length} connections
      </div>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{
          background: "#fafafa",
          borderRadius: 20,
          boxShadow: `10px 10px 15px rgba(198,198,201,0.5), -10px -10px 15px rgba(236,236,236,0.9)`,
          border: "none",
        }}
      />
    </div>
  );
};

export default RepoGraph;
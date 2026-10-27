import {Graph, layout} from '@dagrejs/dagre';
import {useMemo} from 'react';
import type {CodeRef, Diagram} from '../lesson/types';

type Props = {
  diagram: Diagram;
  // Node ids to emphasise, such as the ones the current step talks about.
  active?: Set<string>;
  onOpen: (ref: CodeRef) => void;
};

const nodeWidth = 168;
const nodeHeight = 40;

export function FlowDiagram({diagram, active, onOpen}: Props) {
  const graph = useMemo(() => {
    const g = new Graph();
    g.setGraph({rankdir: 'TB', nodesep: 28, ranksep: 44, marginx: 8, marginy: 8});
    g.setDefaultEdgeLabel(() => ({}));
    for (const node of diagram.nodes) {
      g.setNode(node.id, {width: nodeWidth, height: nodeHeight});
    }

    for (const edge of diagram.edges) {
      g.setEdge(edge.from, edge.to, {label: edge.label, width: edge.label ? edge.label.length * 6.5 : 0, height: edge.label ? 14 : 0, labelpos: 'c'});
    }

    layout(g);
    return g;
  }, [diagram]);

  const {width = 0, height = 0} = graph.graph();

  return (
    <figure className="diagram">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{maxWidth: width}} role="img" aria-label="How the files in this lesson connect">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="diagram__arrowhead" />
          </marker>
        </defs>
        {diagram.edges.map(edge => {
          const laid = graph.edge(edge.from, edge.to);
          if (!laid?.points) {
            return null;
          }

          const d = laid.points.map((p: {x: number; y: number}, i: number) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
          return (
            <g key={`${edge.from}-${edge.to}`} className={`diagram__edge${edge.evidence === 'inferred' ? ' is-inferred' : ''}`}>
              <path d={d} markerEnd="url(#arrow)" />
              {edge.label && laid.x !== undefined && laid.y !== undefined && (
                <text x={laid.x} y={laid.y + 4} textAnchor="middle">{edge.label}</text>
              )}
            </g>
          );
        })}
        {diagram.nodes.map(node => {
          const laid = graph.node(node.id);
          const isActive = active?.has(node.id);
          return (
            <g
              key={node.id}
              className={`diagram__node${isActive ? ' is-active' : ''}`}
              transform={`translate(${laid.x - nodeWidth / 2},${laid.y - nodeHeight / 2})`}
              onClick={() => onOpen(node.ref)}
              role="button"
              tabIndex={0}
              onKeyDown={event => (event.key === 'Enter' || event.key === ' ') && onOpen(node.ref)}
            >
              <title>{`${node.ref.path}:${node.ref.startLine}`}</title>
              <rect width={nodeWidth} height={nodeHeight} rx={8} />
              <text x={nodeWidth / 2} y={nodeHeight / 2 + 5} textAnchor="middle">{node.label}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="muted">Click a box to see its code. Dashed lines are inferred, solid lines are verified.</figcaption>
    </figure>
  );
}

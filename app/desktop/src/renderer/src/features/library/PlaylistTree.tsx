import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaylistTreeNode } from "../../../../shared/contracts";

interface PlaylistTreeProps {
  nodes: PlaylistTreeNode[];
  selectedId: string | null;
  onSelect: (playlistId: string | null) => void;
}

interface VisibleNode {
  id: string | null;
  label: string;
  level: number;
  kind: "all" | PlaylistTreeNode["kind"];
  hasChildren: boolean;
  expanded: boolean;
  parentId: string | null;
  trackCount: number | null;
}

export function PlaylistTree({ nodes, selectedId, onSelect }: PlaylistTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.filter((node) => node.kind === "folder").map((node) => node.id)));
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    setExpanded((current) => {
      const folderIds = nodes.filter((node) => node.kind === "folder").map((node) => node.id);
      if (folderIds.length === 0 || current.size > 0) return current;
      return new Set(folderIds);
    });
  }, [nodes]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, PlaylistTreeNode[]>();
    for (const node of nodes) {
      const children = map.get(node.parentId) ?? [];
      children.push(node);
      map.set(node.parentId, children);
    }
    for (const children of map.values()) {
      children.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
    }
    return map;
  }, [nodes]);

  const visibleNodes = useMemo(() => {
    const result: VisibleNode[] = [{
      id: null,
      label: "All Tracks",
      level: 1,
      kind: "all",
      hasChildren: false,
      expanded: false,
      parentId: null,
      trackCount: null,
    }];
    const append = (parentId: string | null, level: number) => {
      for (const node of childrenByParent.get(parentId) ?? []) {
        const hasChildren = (childrenByParent.get(node.id)?.length ?? 0) > 0;
        const isExpanded = expanded.has(node.id);
        result.push({
          id: node.id,
          label: node.name,
          level,
          kind: node.kind,
          hasChildren,
          expanded: isExpanded,
          parentId: node.parentId,
          trackCount: node.trackCount,
        });
        if (hasChildren && isExpanded) {
          append(node.id, level + 1);
        }
      }
    };
    append(null, 1);
    return result;
  }, [childrenByParent, expanded]);

  const itemKey = (id: string | null) => id ?? "all-tracks";
  const focusNode = (id: string | null) => nodeRefs.current.get(itemKey(id))?.focus();
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, node: VisibleNode, index: number) => {
    const renderedItems = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLDivElement>('[role="treeitem"]') ?? []);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        renderedItems[Math.min(index + 1, renderedItems.length - 1)]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        renderedItems[Math.max(index - 1, 0)]?.focus();
        break;
      case "ArrowRight":
        if (node.hasChildren && node.id !== null && !node.expanded) {
          event.preventDefault();
          toggle(node.id);
        }
        break;
      case "ArrowLeft":
        if (node.hasChildren && node.id !== null && node.expanded) {
          event.preventDefault();
          toggle(node.id);
        } else if (node.parentId !== null) {
          event.preventDefault();
          focusNode(node.parentId);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onSelect(node.id);
        break;
      default:
        break;
    }
  };

  return (
    <nav className="library-navigation" aria-label="Library navigation">
      <p className="sidebar-label">Browse</p>
      <div className="cue-tree" role="tree" aria-label="Playlists">
        {visibleNodes.map((node, index) => {
          const key = itemKey(node.id);
          const isSelected = selectedId === node.id;
          return (
            <div
              key={key}
              ref={(element) => {
                if (element === null) nodeRefs.current.delete(key);
                else nodeRefs.current.set(key, element);
              }}
              className="tree-item"
              role="treeitem"
              tabIndex={index === 0 ? 0 : -1}
              aria-level={node.level}
              aria-selected={isSelected}
              aria-expanded={node.hasChildren ? node.expanded : undefined}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => onKeyDown(event, node, index)}
            >
              <span className="cue-node" aria-hidden="true" />
              <span className="tree-item__label">{node.label}</span>
              {node.hasChildren ? <span className="tree-item__disclosure" aria-hidden="true">{node.expanded ? "−" : "+"}</span> : null}
              {node.trackCount !== null ? <span className="tree-item__count">{node.trackCount}</span> : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

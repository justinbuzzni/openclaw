/**
 * Memory Graph
 *
 * Mem0 영감의 그래프 기반 메모리 관리
 * - 노드: Entity, Concept, Event, Preference 등
 * - 엣지: 관계 (prefers, decided, relates_to 등)
 * - Multi-hop 쿼리 지원
 */

import type { Database } from "duckdb";
import type { AnyEntry, EntryType } from "./types.js";
import type { MemoryCategory } from "./intent-router.js";
import {
  type MemoryNode,
  type MemoryEdge,
  type RelationType,
  calculateTemporalWeight,
} from "./memory-tiers.js";
import { getEmbeddingManager, type EmbeddingConfig } from "./embeddings.js";

// === Graph Query Types ===

export interface GraphTraversalOptions {
  startNodes: string[]; // Starting node IDs or search terms
  maxHops: number;
  relationFilter?: RelationType[];
  categoryFilter?: MemoryCategory[];
  minStrength?: number;
  limit?: number;
}

export interface GraphSearchResult {
  node: MemoryNode;
  path: string[]; // Node IDs from start to this node
  relations: RelationType[]; // Relation types along the path
  totalStrength: number; // Product of edge strengths
  hops: number;
}

// === Memory Graph Manager ===

export class MemoryGraphManager {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * 그래프 테이블 초기화
   */
  async initialize(): Promise<void> {
    await this.runQuery(`
      -- Memory Nodes 테이블
      CREATE TABLE IF NOT EXISTS memory_nodes (
        id VARCHAR PRIMARY KEY,
        type VARCHAR NOT NULL,
        content VARCHAR NOT NULL,
        category VARCHAR NOT NULL,
        temporal_weight DOUBLE DEFAULT 1.0,
        access_count INTEGER DEFAULT 0,
        last_accessed TIMESTAMP DEFAULT now(),
        confidence DOUBLE DEFAULT 0.5,
        created_at TIMESTAMP DEFAULT now(),
        source_entries JSON DEFAULT '[]'
      );

      -- Memory Edges 테이블
      CREATE TABLE IF NOT EXISTS memory_edges (
        id VARCHAR PRIMARY KEY,
        source_id VARCHAR NOT NULL,
        target_id VARCHAR NOT NULL,
        relation VARCHAR NOT NULL,
        strength DOUBLE DEFAULT 0.5,
        created_at TIMESTAMP DEFAULT now(),
        last_confirmed TIMESTAMP,
        confirmations INTEGER DEFAULT 1,
        context VARCHAR,
        FOREIGN KEY (source_id) REFERENCES memory_nodes(id),
        FOREIGN KEY (target_id) REFERENCES memory_nodes(id)
      );

      -- 인덱스
      CREATE INDEX IF NOT EXISTS idx_nodes_type ON memory_nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_category ON memory_nodes(category);
      CREATE INDEX IF NOT EXISTS idx_nodes_content ON memory_nodes(content);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON memory_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_relation ON memory_edges(relation);
    `);
  }

  // === Node Operations ===

  /**
   * 노드 생성 또는 업데이트
   */
  async upsertNode(node: Omit<MemoryNode, "embedding">): Promise<string> {
    const id = node.id || this.generateId("node");

    await this.runQuery(
      `
      INSERT INTO memory_nodes
      (id, type, content, category, temporal_weight, access_count, last_accessed, confidence, created_at, source_entries)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        temporal_weight = EXCLUDED.temporal_weight,
        access_count = memory_nodes.access_count + 1,
        last_accessed = now(),
        confidence = CASE
          WHEN EXCLUDED.confidence > memory_nodes.confidence THEN EXCLUDED.confidence
          ELSE memory_nodes.confidence
        END
    `,
      [
        id,
        node.type,
        node.content,
        node.category,
        node.temporalWeight,
        node.accessCount,
        node.lastAccessed.toISOString(),
        node.confidence,
        node.createdAt.toISOString(),
        JSON.stringify(node.sourceEntries),
      ]
    );

    return id;
  }

  /**
   * 노드 조회
   */
  async getNode(id: string): Promise<MemoryNode | null> {
    const rows = await this.runSelect(
      "SELECT * FROM memory_nodes WHERE id = ?",
      [id]
    );

    if (rows.length === 0) return null;

    return this.rowToNode(rows[0]);
  }

  /**
   * 컨텐츠로 노드 검색 (키워드 기반)
   */
  async searchNodes(
    query: string,
    options?: {
      type?: MemoryNode["type"];
      category?: MemoryCategory;
      limit?: number;
    }
  ): Promise<MemoryNode[]> {
    let sql = `
      SELECT * FROM memory_nodes
      WHERE content ILIKE ?
    `;
    const params: unknown[] = [`%${query}%`];

    if (options?.type) {
      sql += " AND type = ?";
      params.push(options.type);
    }

    if (options?.category) {
      sql += " AND category = ?";
      params.push(options.category);
    }

    sql += " ORDER BY temporal_weight DESC, access_count DESC";

    if (options?.limit) {
      sql += ` LIMIT ${options.limit}`;
    }

    const rows = await this.runSelect(sql, params);
    return rows.map((row) => this.rowToNode(row));
  }

  /**
   * v2.1: Vector Embedding 기반 시맨틱 노드 검색
   */
  async searchNodesSemantic(
    query: string,
    options?: {
      type?: MemoryNode["type"];
      category?: MemoryCategory;
      limit?: number;
      threshold?: number;
      embeddingConfig?: Partial<EmbeddingConfig>;
    }
  ): Promise<Array<{ node: MemoryNode; similarity: number }>> {
    const limit = options?.limit || 10;
    const threshold = options?.threshold || 0.7;

    try {
      const embeddingManager = getEmbeddingManager(options?.embeddingConfig);

      // 후보 노드 가져오기 (키워드 필터링으로 범위 축소)
      let sql = "SELECT * FROM memory_nodes WHERE 1=1";
      const params: unknown[] = [];

      if (options?.type) {
        sql += " AND type = ?";
        params.push(options.type);
      }

      if (options?.category) {
        sql += " AND category = ?";
        params.push(options.category);
      }

      sql += " ORDER BY temporal_weight DESC, access_count DESC LIMIT 100";

      const rows = await this.runSelect(sql, params);
      const candidateNodes = rows.map((row) => this.rowToNode(row));

      if (candidateNodes.length === 0) {
        return [];
      }

      // 쿼리와 후보 노드들의 임베딩 계산
      const texts = [query, ...candidateNodes.map((n) => n.content)];
      const embeddings = await embeddingManager.embedBatch(texts);

      const queryEmbedding = embeddings[0];
      const nodeEmbeddings = embeddings.slice(1);

      // 유사도 계산 및 필터링
      const results: Array<{ node: MemoryNode; similarity: number }> = [];

      for (let i = 0; i < candidateNodes.length; i++) {
        const similarity = embeddingManager.cosineSimilarity(
          queryEmbedding.vector,
          nodeEmbeddings[i].vector
        );

        if (similarity >= threshold) {
          results.push({
            node: candidateNodes[i],
            similarity,
          });
        }
      }

      // 유사도 순으로 정렬 및 제한
      return results
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch (error) {
      // 임베딩 실패 시 키워드 검색으로 폴백
      console.warn(`[MemoryGraph] Semantic search failed, falling back to keyword: ${error}`);
      const keywordResults = await this.searchNodes(query, options);
      return keywordResults.map((node) => ({ node, similarity: 0.5 }));
    }
  }

  /**
   * v2.1: 유사한 노드 찾기 (중복/충돌 감지용)
   */
  async findSimilarNodes(
    content: string,
    options?: {
      excludeId?: string;
      threshold?: number;
      limit?: number;
    }
  ): Promise<Array<{ node: MemoryNode; similarity: number }>> {
    const threshold = options?.threshold || 0.85;
    const limit = options?.limit || 5;

    try {
      const embeddingManager = getEmbeddingManager();

      // 모든 노드 가져오기 (제한된 수)
      let sql = "SELECT * FROM memory_nodes";
      const params: unknown[] = [];

      if (options?.excludeId) {
        sql += " WHERE id != ?";
        params.push(options.excludeId);
      }

      sql += " LIMIT 200";

      const rows = await this.runSelect(sql, params);
      const nodes = rows.map((row) => this.rowToNode(row));

      if (nodes.length === 0) {
        return [];
      }

      // 유사도 계산
      const similar = await embeddingManager.findSimilar(
        content,
        nodes.map((n) => n.content),
        threshold
      );

      return similar.slice(0, limit).map((s) => ({
        node: nodes[s.index],
        similarity: s.similarity,
      }));
    } catch (error) {
      console.warn(`[MemoryGraph] Similar nodes search failed: ${error}`);
      return [];
    }
  }

  /**
   * 노드 접근 기록 업데이트
   */
  async recordNodeAccess(id: string): Promise<void> {
    await this.runQuery(
      `
      UPDATE memory_nodes
      SET access_count = access_count + 1,
          last_accessed = now(),
          temporal_weight = 1.0
      WHERE id = ?
    `,
      [id]
    );
  }

  // === Edge Operations ===

  /**
   * 엣지 생성 또는 강화
   */
  async upsertEdge(edge: Omit<MemoryEdge, "id">): Promise<string> {
    const id = this.generateId("edge");

    // 기존 엣지 확인
    const existing = await this.runSelect(
      `
      SELECT id, strength, confirmations FROM memory_edges
      WHERE source_id = ? AND target_id = ? AND relation = ?
    `,
      [edge.source, edge.target, edge.relation]
    );

    if (existing.length > 0) {
      // 기존 엣지 강화
      const newStrength = Math.min(1.0, (existing[0].strength as number) + 0.1);
      const newConfirmations = (existing[0].confirmations as number) + 1;

      await this.runQuery(
        `
        UPDATE memory_edges
        SET strength = ?,
            confirmations = ?,
            last_confirmed = now(),
            context = COALESCE(?, context)
        WHERE id = ?
      `,
        [newStrength, newConfirmations, edge.context, existing[0].id]
      );

      return existing[0].id as string;
    }

    // 새 엣지 생성
    await this.runQuery(
      `
      INSERT INTO memory_edges
      (id, source_id, target_id, relation, strength, created_at, confirmations, context)
      VALUES (?, ?, ?, ?, ?, now(), 1, ?)
    `,
      [id, edge.source, edge.target, edge.relation, edge.strength, edge.context]
    );

    return id;
  }

  /**
   * 노드의 연결된 엣지 조회
   */
  async getEdgesFromNode(
    nodeId: string,
    direction: "outgoing" | "incoming" | "both" = "both"
  ): Promise<MemoryEdge[]> {
    let sql: string;

    if (direction === "outgoing") {
      sql = "SELECT * FROM memory_edges WHERE source_id = ?";
    } else if (direction === "incoming") {
      sql = "SELECT * FROM memory_edges WHERE target_id = ?";
    } else {
      sql = "SELECT * FROM memory_edges WHERE source_id = ? OR target_id = ?";
    }

    const params = direction === "both" ? [nodeId, nodeId] : [nodeId];
    const rows = await this.runSelect(sql, params);

    return rows.map((row) => this.rowToEdge(row));
  }

  // === Graph Traversal ===

  /**
   * Multi-hop 그래프 탐색
   */
  async traverse(options: GraphTraversalOptions): Promise<GraphSearchResult[]> {
    const results: GraphSearchResult[] = [];
    const visited = new Set<string>();
    const limit = options.limit || 10;

    // BFS 기반 탐색
    const queue: Array<{
      nodeId: string;
      path: string[];
      relations: RelationType[];
      strength: number;
      hops: number;
    }> = [];

    // 시작 노드 찾기
    for (const startTerm of options.startNodes) {
      const startNodes = await this.searchNodes(startTerm, { limit: 3 });
      for (const node of startNodes) {
        queue.push({
          nodeId: node.id,
          path: [node.id],
          relations: [],
          strength: 1.0,
          hops: 0,
        });
      }
    }

    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift()!;

      if (visited.has(current.nodeId)) continue;
      visited.add(current.nodeId);

      // 현재 노드 가져오기
      const node = await this.getNode(current.nodeId);
      if (!node) continue;

      // 카테고리 필터 체크
      if (
        options.categoryFilter &&
        !options.categoryFilter.includes(node.category)
      ) {
        continue;
      }

      // 결과에 추가 (시작 노드가 아닌 경우)
      if (current.hops > 0) {
        results.push({
          node,
          path: current.path,
          relations: current.relations,
          totalStrength: current.strength,
          hops: current.hops,
        });
      }

      // 최대 홉 체크
      if (current.hops >= options.maxHops) continue;

      // 연결된 엣지 탐색
      const edges = await this.getEdgesFromNode(current.nodeId, "outgoing");

      for (const edge of edges) {
        // 관계 필터 체크
        if (
          options.relationFilter &&
          !options.relationFilter.includes(edge.relation)
        ) {
          continue;
        }

        // 최소 strength 체크
        if (options.minStrength && edge.strength < options.minStrength) {
          continue;
        }

        // 다음 노드 큐에 추가
        queue.push({
          nodeId: edge.target,
          path: [...current.path, edge.target],
          relations: [...current.relations, edge.relation],
          strength: current.strength * edge.strength,
          hops: current.hops + 1,
        });
      }
    }

    // 강도 순으로 정렬
    return results.sort((a, b) => b.totalStrength - a.totalStrength);
  }

  /**
   * 두 노드 간의 관계 경로 찾기
   */
  async findPath(
    sourceId: string,
    targetId: string,
    maxHops = 3
  ): Promise<GraphSearchResult | null> {
    const results = await this.traverse({
      startNodes: [sourceId],
      maxHops,
    });

    return results.find((r) => r.node.id === targetId) || null;
  }

  /**
   * 선호도 관련 노드 탐색
   */
  async findPreferences(
    userId?: string,
    category?: MemoryCategory
  ): Promise<GraphSearchResult[]> {
    return this.traverse({
      startNodes: userId ? [userId] : ["user_preferences"],
      maxHops: 2,
      relationFilter: ["prefers", "dislikes"],
      categoryFilter: category ? [category] : undefined,
      limit: 10,
    });
  }

  /**
   * 충돌 관계 찾기
   */
  async findConflicts(nodeId?: string): Promise<Array<{ node1: MemoryNode; node2: MemoryNode; edge: MemoryEdge }>> {
    let sql = `
      SELECT e.*,
             n1.id as n1_id, n1.type as n1_type, n1.content as n1_content, n1.category as n1_category,
             n1.temporal_weight as n1_tw, n1.access_count as n1_ac, n1.last_accessed as n1_la,
             n1.confidence as n1_conf, n1.created_at as n1_ca, n1.source_entries as n1_se,
             n2.id as n2_id, n2.type as n2_type, n2.content as n2_content, n2.category as n2_category,
             n2.temporal_weight as n2_tw, n2.access_count as n2_ac, n2.last_accessed as n2_la,
             n2.confidence as n2_conf, n2.created_at as n2_ca, n2.source_entries as n2_se
      FROM memory_edges e
      JOIN memory_nodes n1 ON e.source_id = n1.id
      JOIN memory_nodes n2 ON e.target_id = n2.id
      WHERE e.relation = 'contradicts'
    `;

    const params: unknown[] = [];
    if (nodeId) {
      sql += " AND (e.source_id = ? OR e.target_id = ?)";
      params.push(nodeId, nodeId);
    }

    const rows = await this.runSelect(sql, params);

    return rows.map((row) => ({
      node1: this.rowToNode({
        id: row.n1_id,
        type: row.n1_type,
        content: row.n1_content,
        category: row.n1_category,
        temporal_weight: row.n1_tw,
        access_count: row.n1_ac,
        last_accessed: row.n1_la,
        confidence: row.n1_conf,
        created_at: row.n1_ca,
        source_entries: row.n1_se,
      }),
      node2: this.rowToNode({
        id: row.n2_id,
        type: row.n2_type,
        content: row.n2_content,
        category: row.n2_category,
        temporal_weight: row.n2_tw,
        access_count: row.n2_ac,
        last_accessed: row.n2_la,
        confidence: row.n2_conf,
        created_at: row.n2_ca,
        source_entries: row.n2_se,
      }),
      edge: this.rowToEdge(row),
    }));
  }

  // === Entry → Graph Conversion ===

  /**
   * Entry에서 노드와 엣지 추출
   */
  async indexEntry(
    entry: AnyEntry,
    entryId: string,
    category: MemoryCategory
  ): Promise<{ nodes: string[]; edges: string[] }> {
    const createdNodeIds: string[] = [];
    const createdEdgeIds: string[] = [];

    // 메인 노드 생성
    const mainNodeId = await this.upsertNode({
      id: `entry_${entryId}`,
      type: this.entryTypeToNodeType(entry.type),
      content: this.getEntryContent(entry),
      category,
      temporalWeight: 1.0,
      accessCount: 0,
      lastAccessed: new Date(),
      confidence: 0.5,
      createdAt: new Date(),
      sourceEntries: [entryId],
    });
    createdNodeIds.push(mainNodeId);

    // Entry 타입별 추가 노드/엣지 생성
    switch (entry.type) {
      case "fact":
        if (entry.evidence) {
          const evidenceNodeId = await this.upsertNode({
            id: this.generateId("evidence"),
            type: "concept",
            content: entry.evidence,
            category,
            temporalWeight: 1.0,
            accessCount: 0,
            lastAccessed: new Date(),
            confidence: 0.3,
            createdAt: new Date(),
            sourceEntries: [entryId],
          });
          createdNodeIds.push(evidenceNodeId);

          const edgeId = await this.upsertEdge({
            source: mainNodeId,
            target: evidenceNodeId,
            relation: "relates_to",
            strength: 0.7,
            createdAt: new Date(),
            confirmations: 1,
            context: "fact evidence",
          });
          createdEdgeIds.push(edgeId);
        }
        break;

      case "decision":
        if (entry.basedOn && entry.basedOn.length > 0) {
          for (const factRef of entry.basedOn) {
            // 참조된 fact 노드 찾기 또는 생성
            const factNodes = await this.searchNodes(factRef, { type: "concept", limit: 1 });
            let factNodeId: string;

            if (factNodes.length > 0) {
              factNodeId = factNodes[0].id;
            } else {
              factNodeId = await this.upsertNode({
                id: this.generateId("fact_ref"),
                type: "concept",
                content: factRef,
                category,
                temporalWeight: 0.5,
                accessCount: 0,
                lastAccessed: new Date(),
                confidence: 0.3,
                createdAt: new Date(),
                sourceEntries: [entryId],
              });
              createdNodeIds.push(factNodeId);
            }

            const edgeId = await this.upsertEdge({
              source: mainNodeId,
              target: factNodeId,
              relation: "decided",
              strength: 0.8,
              createdAt: new Date(),
              confirmations: 1,
              context: "decision based on fact",
            });
            createdEdgeIds.push(edgeId);
          }
        }
        break;

      case "insight":
        if (entry.implication) {
          const implNodeId = await this.upsertNode({
            id: this.generateId("implication"),
            type: "concept",
            content: entry.implication,
            category,
            temporalWeight: 1.0,
            accessCount: 0,
            lastAccessed: new Date(),
            confidence: 0.4,
            createdAt: new Date(),
            sourceEntries: [entryId],
          });
          createdNodeIds.push(implNodeId);

          const edgeId = await this.upsertEdge({
            source: mainNodeId,
            target: implNodeId,
            relation: "relates_to",
            strength: 0.6,
            createdAt: new Date(),
            confirmations: 1,
            context: "insight implication",
          });
          createdEdgeIds.push(edgeId);
        }
        break;

      case "task":
        // Task는 project 노드와 연결
        const projectNodes = await this.searchNodes("project", { type: "project", limit: 1 });
        if (projectNodes.length > 0) {
          const edgeId = await this.upsertEdge({
            source: projectNodes[0].id,
            target: mainNodeId,
            relation: "part_of",
            strength: 0.5,
            createdAt: new Date(),
            confirmations: 1,
            context: "task in project",
          });
          createdEdgeIds.push(edgeId);
        }
        break;
    }

    return { nodes: createdNodeIds, edges: createdEdgeIds };
  }

  // === Temporal Weight Decay ===

  /**
   * 모든 노드의 temporal weight 감쇠 적용
   */
  async applyTemporalDecay(decayRate = 0.1): Promise<number> {
    // 각 노드의 temporal weight를 last_accessed 기반으로 재계산
    const nodes = await this.runSelect("SELECT id, last_accessed FROM memory_nodes");
    let updated = 0;

    for (const node of nodes) {
      const lastAccessed = new Date(node.last_accessed as string);
      const newWeight = calculateTemporalWeight(lastAccessed, decayRate);

      await this.runQuery(
        "UPDATE memory_nodes SET temporal_weight = ? WHERE id = ?",
        [newWeight, node.id]
      );
      updated++;
    }

    return updated;
  }

  // === Helper Methods ===

  private entryTypeToNodeType(entryType: EntryType): MemoryNode["type"] {
    const mapping: Record<EntryType, MemoryNode["type"]> = {
      fact: "concept",
      decision: "event",
      insight: "concept",
      task: "event",
      reference: "entity",
    };
    return mapping[entryType];
  }

  private getEntryContent(entry: AnyEntry): string {
    switch (entry.type) {
      case "fact":
      case "decision":
      case "task":
        return entry.title;
      case "insight":
        return entry.observation;
      case "reference":
        return entry.path;
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private rowToNode(row: Record<string, unknown>): MemoryNode {
    return {
      id: row.id as string,
      type: row.type as MemoryNode["type"],
      content: row.content as string,
      category: row.category as MemoryCategory,
      temporalWeight: row.temporal_weight as number,
      accessCount: row.access_count as number,
      lastAccessed: new Date(row.last_accessed as string),
      confidence: row.confidence as number,
      createdAt: new Date(row.created_at as string),
      sourceEntries: JSON.parse((row.source_entries as string) || "[]"),
    };
  }

  private rowToEdge(row: Record<string, unknown>): MemoryEdge {
    return {
      id: row.id as string,
      source: row.source_id as string,
      target: row.target_id as string,
      relation: row.relation as RelationType,
      strength: row.strength as number,
      createdAt: new Date(row.created_at as string),
      lastConfirmed: row.last_confirmed ? new Date(row.last_confirmed as string) : undefined,
      confirmations: row.confirmations as number,
      context: row.context as string | undefined,
    };
  }

  private runQuery(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, ...params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private runSelect(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, ...params, (err: Error | null, rows: Record<string, unknown>[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
}

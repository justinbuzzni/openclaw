/**
 * Similarity Module
 *
 * 새 엔트리와 기존 엔트리 간 유사도를 계산하고
 * 유사한 엔트리의 confirmation_count를 증가시킴
 */

import type * as duckdb from "duckdb";
import type { AnyEntry } from "./types.js";

// 유사도 설정
const SIMILARITY_THRESHOLD = 0.85; // 85% 이상 유사하면 확인으로 간주
const MAX_CANDIDATES = 50; // 비교할 최대 후보 수

export interface SimilarEntry {
  id: string;
  similarity: number;
  title: string;
  type: string;
}

export class SimilarityChecker {
  private db: duckdb.Database;

  constructor(db: duckdb.Database) {
    this.db = db;
  }

  /**
   * 새 엔트리와 유사한 기존 엔트리 찾기
   * 유사도가 높은 경우 confirmation_count 증가
   */
  async checkAndConfirm(newEntry: AnyEntry): Promise<SimilarEntry[]> {
    // 같은 타입의 엔트리만 검색
    const candidates = await this.getCandidates(newEntry.type);

    const newText = this.entryToText(newEntry);
    const similar: SimilarEntry[] = [];

    for (const candidate of candidates) {
      const candidateText = candidate.text_for_search as string;
      const similarity = this.calculateSimilarity(newText, candidateText);

      if (similarity >= SIMILARITY_THRESHOLD) {
        similar.push({
          id: candidate.id as string,
          similarity,
          title: candidate.title as string,
          type: candidate.entry_type as string,
        });

        // confirmation_count 증가
        await this.incrementConfirmation(candidate.id as string);
      }
    }

    return similar;
  }

  /**
   * 후보 엔트리 조회
   */
  private async getCandidates(
    entryType: string
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        `
        SELECT id, title, entry_type, text_for_search, memory_stage
        FROM entries
        WHERE entry_type = ?
          AND COALESCE(memory_stage, 'working') IN ('working', 'candidate', 'verified', 'certified')
        ORDER BY created_at DESC
        LIMIT ?
      `,
        entryType,
        MAX_CANDIDATES,
        (err: Error | null, rows: Record<string, unknown>[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * confirmation_count 증가
   */
  private async incrementConfirmation(entryId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        UPDATE entries
        SET confirmation_count = COALESCE(confirmation_count, 0) + 1,
            last_accessed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
        entryId,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 유사도 계산 (TF-IDF 기반 코사인 유사도 간소화 버전)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    // 단어 빈도 계산
    const freq1 = this.getWordFrequency(text1);
    const freq2 = this.getWordFrequency(text2);

    // 모든 단어 집합
    const allWords = new Set([...freq1.keys(), ...freq2.keys()]);

    // 코사인 유사도 계산
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const word of allWords) {
      const f1 = freq1.get(word) || 0;
      const f2 = freq2.get(word) || 0;

      dotProduct += f1 * f2;
      norm1 += f1 * f1;
      norm2 += f2 * f2;
    }

    if (norm1 === 0 || norm2 === 0) return 0;

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * 단어 빈도 계산
   */
  private getWordFrequency(text: string): Map<string, number> {
    const freq = new Map<string, number>();

    // 정규화 및 토큰화
    const words = text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1);

    for (const word of words) {
      freq.set(word, (freq.get(word) || 0) + 1);
    }

    return freq;
  }

  /**
   * 엔트리를 텍스트로 변환
   */
  private entryToText(entry: AnyEntry): string {
    switch (entry.type) {
      case "fact":
        return `${entry.title} ${entry.evidence || ""}`;
      case "decision":
        return `${entry.title} ${entry.rationale || ""} ${(entry.basedOn || []).join(" ")}`;
      case "insight":
        return `${entry.observation} ${entry.implication}`;
      case "task":
        return entry.title;
      case "reference":
        return `${entry.path} ${entry.description || ""}`;
      default:
        return JSON.stringify(entry);
    }
  }

  /**
   * 유사한 엔트리 검색 (UI용)
   */
  async findSimilar(
    entry: AnyEntry,
    threshold: number = 0.7
  ): Promise<SimilarEntry[]> {
    const candidates = await this.getCandidates(entry.type);
    const newText = this.entryToText(entry);
    const similar: SimilarEntry[] = [];

    for (const candidate of candidates) {
      const candidateText = candidate.text_for_search as string;
      const similarity = this.calculateSimilarity(newText, candidateText);

      if (similarity >= threshold) {
        similar.push({
          id: candidate.id as string,
          similarity,
          title: candidate.title as string,
          type: candidate.entry_type as string,
        });
      }
    }

    return similar.sort((a, b) => b.similarity - a.similarity);
  }
}

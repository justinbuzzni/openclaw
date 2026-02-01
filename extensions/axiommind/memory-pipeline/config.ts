/**
 * AxiomMind Configuration
 *
 * 환경변수 및 설정 파일에서 설정 값을 로드
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// 기본 설정 값
const DEFAULT_CONFIG = {
  // Memory Pipeline
  dataDir: path.join(os.homedir(), ".openclaw", "axiommind"),

  // Graduation Pipeline
  graduation: {
    daysForVerified: 7,      // L2 → L3 자동 승격 대기 일수
    daysForCertified: 30,    // L3 → L4 자동 승격 대기 일수
    daysForDemotion: 90,     // 미사용 시 강등 대기 일수
    confirmationThreshold: 3, // L2 → L3 확인 횟수 임계값
  },

  // Similarity Check
  similarity: {
    threshold: 0.85,         // 유사도 임계값
    maxCandidates: 50,       // 비교할 최대 후보 수
  },

  // API
  api: {
    maxSearchResults: 20,
    defaultSearchLimit: 10,
  },

  // Auth
  auth: {
    token: undefined as string | undefined, // AXIOMMIND_AUTH_TOKEN 환경변수
  },
};

export type AxiomMindConfig = typeof DEFAULT_CONFIG;

/**
 * 환경변수에서 설정 로드
 */
function loadFromEnv(config: AxiomMindConfig): void {
  // AXIOMMIND_AUTH_TOKEN - 인증 토큰
  const authToken = process.env.AXIOMMIND_AUTH_TOKEN;
  if (authToken) {
    config.auth.token = authToken;
  }

  // AXIOMMIND_DATA_DIR - 데이터 디렉토리
  const dataDir = process.env.AXIOMMIND_DATA_DIR;
  if (dataDir) {
    config.dataDir = dataDir;
  }

  // AXIOMMIND_DAYS_FOR_VERIFIED - 승격 대기 일수
  const daysForVerified = process.env.AXIOMMIND_DAYS_FOR_VERIFIED;
  if (daysForVerified) {
    config.graduation.daysForVerified = parseInt(daysForVerified, 10);
  }

  // AXIOMMIND_DAYS_FOR_CERTIFIED - 승격 대기 일수
  const daysForCertified = process.env.AXIOMMIND_DAYS_FOR_CERTIFIED;
  if (daysForCertified) {
    config.graduation.daysForCertified = parseInt(daysForCertified, 10);
  }

  // AXIOMMIND_SIMILARITY_THRESHOLD - 유사도 임계값
  const similarityThreshold = process.env.AXIOMMIND_SIMILARITY_THRESHOLD;
  if (similarityThreshold) {
    config.similarity.threshold = parseFloat(similarityThreshold);
  }
}

/**
 * 설정 파일에서 설정 로드
 */
function loadFromFile(config: AxiomMindConfig): void {
  const configPath = path.join(os.homedir(), ".openclaw", "axiommind", "config.json");

  if (!fs.existsSync(configPath)) {
    return;
  }

  try {
    const fileContent = fs.readFileSync(configPath, "utf-8");
    const fileConfig = JSON.parse(fileContent);

    // 깊은 병합
    if (fileConfig.dataDir) {
      config.dataDir = fileConfig.dataDir;
    }

    if (fileConfig.graduation) {
      Object.assign(config.graduation, fileConfig.graduation);
    }

    if (fileConfig.similarity) {
      Object.assign(config.similarity, fileConfig.similarity);
    }

    if (fileConfig.api) {
      Object.assign(config.api, fileConfig.api);
    }

    if (fileConfig.auth?.token) {
      config.auth.token = fileConfig.auth.token;
    }
  } catch (error) {
    console.warn(`Failed to load AxiomMind config from ${configPath}:`, error);
  }
}

/**
 * 설정 로드 (환경변수 > 설정 파일 > 기본값)
 */
export function loadConfig(): AxiomMindConfig {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AxiomMindConfig;

  // 1. 설정 파일에서 로드 (있으면)
  loadFromFile(config);

  // 2. 환경변수에서 로드 (우선순위 높음)
  loadFromEnv(config);

  return config;
}

// 싱글톤 설정 인스턴스
let configInstance: AxiomMindConfig | null = null;

/**
 * 설정 가져오기 (싱글톤)
 */
export function getConfig(): AxiomMindConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * 설정 리셋 (테스트용)
 */
export function resetConfig(): void {
  configInstance = null;
}

export default getConfig;

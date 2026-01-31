/**
 * Idris Validator
 *
 * Idris2 컴파일러를 사용하여 생성된 코드의 타입 검사
 */
import { spawn } from "node:child_process";
import * as path from "node:path";
import type { CompileResult } from "./types.js";

export class IdrisValidator {
  private projectRoot: string;
  private sourceDir: string;

  constructor(dataDir: string) {
    this.projectRoot = dataDir;
    this.sourceDir = path.join(dataDir, "src");
  }

  async validate(idrPath: string): Promise<CompileResult> {
    return new Promise((resolve) => {
      const proc = spawn("idris2", ["--check", idrPath, "--source-dir", this.sourceDir], {
        cwd: this.projectRoot,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        const errors = this.parseErrors(stderr);
        const warnings = this.parseWarnings(stderr);
        const holes = this.parseHoles(stdout);

        resolve({
          success: code === 0 && errors.length === 0,
          errors,
          warnings,
          holes,
        });
      });

      proc.on("error", (err) => {
        // idris2가 설치되지 않은 경우
        resolve({
          success: false,
          errors: [`Idris2 not found: ${err.message}`],
          warnings: [],
          holes: [],
        });
      });
    });
  }

  /**
   * Idris2 설치 여부 확인
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("idris2", ["--version"]);

      proc.on("close", (code) => {
        resolve(code === 0);
      });

      proc.on("error", () => {
        resolve(false);
      });
    });
  }

  private parseErrors(output: string): string[] {
    const errors: string[] = [];

    for (const line of output.split("\n")) {
      if (line.includes("Error:") || line.toLowerCase().includes("error:")) {
        errors.push(line.trim());
      }
    }

    return errors;
  }

  private parseWarnings(output: string): string[] {
    const warnings: string[] = [];

    for (const line of output.split("\n")) {
      if (line.includes("Warning:")) {
        warnings.push(line.trim());
      }
    }

    return warnings;
  }

  private parseHoles(output: string): string[] {
    const holes: string[] = [];

    for (const line of output.split("\n")) {
      if (line.includes("?") && line.toLowerCase().includes("hole")) {
        holes.push(line.trim());
      }
    }

    return holes;
  }
}

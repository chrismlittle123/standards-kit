import { type _Object, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

import { type CheckResult, type Violation } from "../../core/index.js";
import { BaseProcessToolRunner } from "./base.js";

/** Backups configuration */
interface BackupsConfig {
  enabled?: boolean;
  bucket?: string;
  prefix?: string;
  max_age_hours?: number;
  region?: string;
}

/**
 * Runner for S3 backup verification.
 * Checks that backups exist in S3 and are recent.
 */
export class BackupsRunner extends BaseProcessToolRunner {
  readonly name = "Backups";
  readonly rule = "process.backups";
  readonly toolId = "backups";

  private config: BackupsConfig = { enabled: false };
  private s3Client: S3Client | null = null;

  setConfig(config: BackupsConfig): void {
    this.config = { ...this.config, ...config };
  }

  /** Allow injecting S3 client for testing */
  setS3Client(client: S3Client): void {
    this.s3Client = client;
  }

  async run(_projectRoot: string): Promise<CheckResult> {
    const startTime = Date.now();
    const elapsed = (): number => Date.now() - startTime;

    if (!this.config.bucket) {
      return this.skip("No bucket configured", elapsed());
    }

    try {
      const violations = await this.checkBackups();
      return this.fromViolations(violations, elapsed());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.skip(`S3 error: ${message}`, elapsed());
    }
  }

  private async checkBackups(): Promise<Violation[]> {
    const client = this.getS3Client();
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: this.config.prefix,
      })
    );

    if (!response.Contents || response.Contents.length === 0) {
      return [this.createExistsViolation()];
    }

    return this.checkBackupRecency(response.Contents);
  }

  private getS3Client(): S3Client {
    return (
      this.s3Client ??
      new S3Client({
        region: this.config.region ?? process.env.AWS_REGION ?? "us-east-1",
      })
    );
  }

  private createExistsViolation(): Violation {
    return {
      rule: `${this.rule}.exists`,
      tool: this.toolId,
      message: `No backups found at s3://${this.config.bucket}/${this.config.prefix ?? ""}`,
      severity: "error",
    };
  }

  private checkBackupRecency(contents: _Object[]): Violation[] {
    const mostRecent = this.findMostRecentBackup(contents);

    if (!mostRecent?.LastModified) {
      return [
        {
          rule: `${this.rule}.recency`,
          tool: this.toolId,
          message: "Could not determine backup age",
          severity: "error",
        },
      ];
    }

    const maxAgeHours = this.config.max_age_hours ?? 24;
    const ageHours = (Date.now() - mostRecent.LastModified.getTime()) / (1000 * 60 * 60);

    if (ageHours > maxAgeHours) {
      return [
        {
          rule: `${this.rule}.recency`,
          tool: this.toolId,
          message: `Backup is ${Math.round(ageHours)} hours old (max: ${maxAgeHours} hours)`,
          severity: "error",
          file: mostRecent.Key,
        },
      ];
    }

    return [];
  }

  private findMostRecentBackup(contents: _Object[]): _Object | undefined {
    const withDates = contents.filter(
      (obj): obj is _Object & { LastModified: Date } => obj.LastModified !== undefined
    );
    return withDates.sort((a, b) => b.LastModified.getTime() - a.LastModified.getTime())[0];
  }
}

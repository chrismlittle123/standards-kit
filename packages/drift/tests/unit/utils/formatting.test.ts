import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  COLORS,
  STATUS_ICONS,
  SEVERITY_COLORS,
  getSeverityColor,
  printWarnings,
  isGitHubActions,
  actionsOutput,
} from "../../../src/utils/formatting.js";

describe("formatting", () => {
  describe("COLORS", () => {
    it("exports ANSI color codes", () => {
      expect(COLORS.reset).toBe("\x1b[0m");
      expect(COLORS.bold).toBe("\x1b[1m");
      expect(COLORS.red).toBe("\x1b[31m");
      expect(COLORS.green).toBe("\x1b[32m");
      expect(COLORS.yellow).toBe("\x1b[33m");
      expect(COLORS.cyan).toBe("\x1b[36m");
    });
  });

  describe("STATUS_ICONS", () => {
    it("exports colored status icons", () => {
      expect(STATUS_ICONS.pass).toContain("✓");
      expect(STATUS_ICONS.fail).toContain("✗");
      expect(STATUS_ICONS.skip).toContain("○");
      expect(STATUS_ICONS.error).toContain("!");
      expect(STATUS_ICONS.warning).toContain("!");
    });
  });

  describe("SEVERITY_COLORS", () => {
    it("maps severity levels to colors", () => {
      expect(SEVERITY_COLORS.critical).toBe(COLORS.red);
      expect(SEVERITY_COLORS.high).toBe(COLORS.yellow);
      expect(SEVERITY_COLORS.medium).toBe(COLORS.cyan);
      expect(SEVERITY_COLORS.low).toBe(COLORS.white);
    });
  });

  describe("getSeverityColor", () => {
    it("returns color for known severity", () => {
      expect(getSeverityColor("critical")).toBe(COLORS.red);
      expect(getSeverityColor("high")).toBe(COLORS.yellow);
      expect(getSeverityColor("medium")).toBe(COLORS.cyan);
      expect(getSeverityColor("low")).toBe(COLORS.white);
    });

    it("returns reset for unknown severity", () => {
      expect(getSeverityColor("unknown")).toBe(COLORS.reset);
      expect(getSeverityColor("")).toBe(COLORS.reset);
    });
  });

  describe("printWarnings", () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it("prints warning title and messages", () => {
      printWarnings("Test Warning", ["warning 1", "warning 2"]);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Test Warning")
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("─"));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("warning 1")
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("warning 2")
      );
    });

    it("prints additional message when provided", () => {
      printWarnings("Title", ["warning"], "Additional info");

      expect(consoleSpy).toHaveBeenCalledWith("Additional info");
    });

    it("does not print additional message when not provided", () => {
      printWarnings("Title", ["warning"]);

      const calls = consoleSpy.mock.calls.map((call: unknown[]) => call[0]);
      expect(calls).not.toContain(undefined);
    });
  });

  describe("isGitHubActions", () => {
    const originalEnv = process.env.GITHUB_ACTIONS;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.GITHUB_ACTIONS = originalEnv;
      } else {
        delete process.env.GITHUB_ACTIONS;
      }
    });

    it("returns true when GITHUB_ACTIONS is 'true'", () => {
      process.env.GITHUB_ACTIONS = "true";
      expect(isGitHubActions()).toBe(true);
    });

    it("returns false when GITHUB_ACTIONS is not set", () => {
      delete process.env.GITHUB_ACTIONS;
      expect(isGitHubActions()).toBe(false);
    });

    it("returns false when GITHUB_ACTIONS is 'false'", () => {
      process.env.GITHUB_ACTIONS = "false";
      expect(isGitHubActions()).toBe(false);
    });
  });

  describe("actionsOutput", () => {
    const originalEnv = process.env.GITHUB_ACTIONS;
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
      if (originalEnv !== undefined) {
        process.env.GITHUB_ACTIONS = originalEnv;
      } else {
        delete process.env.GITHUB_ACTIONS;
      }
    });

    describe("when not in GitHub Actions", () => {
      beforeEach(() => {
        delete process.env.GITHUB_ACTIONS;
      });

      it("error does nothing", () => {
        actionsOutput.error("test error");
        expect(consoleSpy).not.toHaveBeenCalled();
      });

      it("warning does nothing", () => {
        actionsOutput.warning("test warning");
        expect(consoleSpy).not.toHaveBeenCalled();
      });

      it("notice does nothing", () => {
        actionsOutput.notice("test notice");
        expect(consoleSpy).not.toHaveBeenCalled();
      });

      it("startGroup does nothing", () => {
        actionsOutput.startGroup("test group");
        expect(consoleSpy).not.toHaveBeenCalled();
      });

      it("endGroup does nothing", () => {
        actionsOutput.endGroup();
        expect(consoleSpy).not.toHaveBeenCalled();
      });
    });

    describe("when in GitHub Actions", () => {
      beforeEach(() => {
        process.env.GITHUB_ACTIONS = "true";
      });

      describe("error", () => {
        it("outputs error command without file", () => {
          actionsOutput.error("test error message");
          expect(consoleSpy).toHaveBeenCalledWith(
            "::error::test error message"
          );
        });

        it("outputs error command with file", () => {
          actionsOutput.error("test error", "src/file.ts");
          expect(consoleSpy).toHaveBeenCalledWith(
            "::error file=src/file.ts::test error"
          );
        });
      });

      describe("warning", () => {
        it("outputs warning command without file", () => {
          actionsOutput.warning("test warning message");
          expect(consoleSpy).toHaveBeenCalledWith(
            "::warning::test warning message"
          );
        });

        it("outputs warning command with file", () => {
          actionsOutput.warning("test warning", "src/file.ts");
          expect(consoleSpy).toHaveBeenCalledWith(
            "::warning file=src/file.ts::test warning"
          );
        });
      });

      describe("notice", () => {
        it("outputs notice command", () => {
          actionsOutput.notice("test notice message");
          expect(consoleSpy).toHaveBeenCalledWith(
            "::notice::test notice message"
          );
        });
      });

      describe("startGroup", () => {
        it("outputs group command", () => {
          actionsOutput.startGroup("My Group Title");
          expect(consoleSpy).toHaveBeenCalledWith("::group::My Group Title");
        });
      });

      describe("endGroup", () => {
        it("outputs endgroup command", () => {
          actionsOutput.endGroup();
          expect(consoleSpy).toHaveBeenCalledWith("::endgroup::");
        });
      });
    });
  });
});

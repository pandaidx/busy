// One-time setup: asks for the account and the Vercel token without echoing
// them, generates internal secrets and stores them in the linked hub project.
// Usage (from apps/hub): node scripts/setup-secrets.ts
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { hashPassword } from "../lib/auth/password.ts";

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return new Promise((resolve) => {
    // Pass the question to readline: it redraws the line, which would erase a prompt written before.
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) {
        process.stdout.write("\n");
      }
      resolve(answer.trim());
    });
    if (hidden) {
      const masked = rl as unknown as {
        _writeToOutput: (s: string) => void;
        line: string;
      };
      masked._writeToOutput = () => {
        process.stdout.write(
          `\r\x1b[2K${question}${"*".repeat(masked.line.length)}`
        );
      };
    }
  });
}

function setEnv(key: string, value: string, environments: string[]) {
  for (const target of environments) {
    const r = spawnSync("vercel", ["env", "add", key, target, "--force"], {
      input: value,
      stdio: ["pipe", "ignore", "inherit"],
    });
    if (r.status !== 0) {
      throw new Error(`vercel env add ${key} ${target} failed`);
    }
  }
  console.log(`✓ ${key}`);
}

const user = (await ask("App username [owner]: ")) || "owner";
const password = await ask("App password (hidden): ", true);
if (password.length < 12) {
  throw new Error(
    "Use a password of 12 characters or more: the hub is on the internet."
  );
}
const token = await ask("Vercel token for this Vercel team (hidden): ", true);
if (!token) {
  throw new Error("A Vercel token is required to deploy and manage bots");
}
const botBaseImage = await ask(
  "BOT_BASE_IMAGE from images/bot-base/push.sh, or Enter if not published yet: "
);
// Same rule as the hub (lib/bots/service.ts): bots only deploy from a digest-pinned image.
if (botBaseImage && !/@sha256:[a-f0-9]{64}$/u.test(botBaseImage)) {
  throw new Error(
    "BOT_BASE_IMAGE must end in @sha256:<64 hex>. See docs/bot-base-image.md"
  );
}
const tokenPass = await ask(
  "Token Pass key, or Enter to use AI Gateway: ",
  true
);

const both = ["production", "development"];
setEnv("BUSY_USER", user, both);
setEnv("BUSY_PASSWORD_HASH", await hashPassword(password), both);
// One per environment: a `vercel env pull` must never bring the key that signs production cookies.
for (const env of both) {
  setEnv("SESSION_SECRET", randomBytes(32).toString("base64url"), [env]);
}
setEnv("CRON_SECRET", randomBytes(32).toString("base64url"), ["production"]);
if (token) {
  setEnv("VERCEL_TOKEN", token, both);
}
if (botBaseImage) {
  setEnv("BOT_BASE_IMAGE", botBaseImage, both);
}
if (tokenPass) {
  setEnv("TOKEN_PASS_API_KEY", tokenPass, both);
}
if (!botBaseImage) {
  console.log(
    "\n! BOT_BASE_IMAGE is not set: bots cannot deploy until you publish your image and set it (docs/bot-base-image.md)."
  );
}
console.log("\nDone. Redeploy the linked hub project to apply these values.");

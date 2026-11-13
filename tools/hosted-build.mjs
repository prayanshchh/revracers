import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "build/hosted");
const site = path.join(out, "site");
const zip = path.join(out, "revracers-web.zip");
const mebibyte = 1024 * 1024;
const limits = {
  files: 2000,
  fileBytes: 200 * mebibyte,
  zipBytes: 500 * mebibyte,
};
const left = [/\.br$/, /^intro\//];

function files(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      return files(path.join(dir, entry.name), `${name}/`);
    return left.some((rule) => rule.test(name)) ? [] : [name];
  });
}

execFileSync("pnpm", ["--filter", "./apps/client", "exec", "vite", "build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    REVRACERS_HOSTED:
      process.env["REVRACERS_SERVER"] ?? "https://revracers.com",
  },
});

const shipped = files(site);
const problems = [];
if (!shipped.includes("index.html")) problems.push("index.html is missing");
if (shipped.length > limits.files)
  problems.push(
    `${String(shipped.length)} files (limit ${String(limits.files)})`,
  );
for (const name of shipped) {
  const bytes = statSync(path.join(site, name)).size;
  if (bytes > limits.fileBytes)
    problems.push(`${name} is ${(bytes / mebibyte).toFixed(1)} MiB`);
}

rmSync(zip, { force: true });
execFileSync("zip", ["-X", "-q", "-9", zip, "-@"], {
  cwd: site,
  input: shipped.join("\n"),
  stdio: ["pipe", "inherit", "inherit"],
});
const zipBytes = statSync(zip).size;
if (zipBytes > limits.zipBytes)
  problems.push(`zip is ${(zipBytes / mebibyte).toFixed(1)} MiB`);

if (problems.length > 0) {
  process.stderr.write(
    `hosted build is over the upload limits:\n${problems.join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `${zip}\n${String(shipped.length)} files, ${(zipBytes / mebibyte).toFixed(1)} MiB\n`,
);

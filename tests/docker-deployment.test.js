import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Dockerfile installs only runtime dependencies and lark-cli", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /npm install -g @larksuite\/cli@1\.0\.40/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /CMD \["npm", "start"\]/);
  assert.doesNotMatch(dockerfile, /npm install -g .*ollama/);
  assert.doesNotMatch(dockerfile, /npm install -g .*hermes/);
});

test("docker compose persists project config prompt state and lark-cli auth", () => {
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");

  assert.match(compose, /reply-pilot:/);
  assert.match(compose, /reply-pilot-state:\/app\/\.reply-pilot/);
  assert.match(compose, /\.\/prompt\.md:\/app\/prompt\.md/);
  assert.match(compose, /lark-cli-home:\/home\/node\/\.lark-cli/);
  assert.doesNotMatch(compose, /OLLAMA_HOST/);
  assert.doesNotMatch(compose, /hermes/);
});

test("dockerignore keeps local state and dependencies out of build context", () => {
  const dockerignore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");

  assert.match(dockerignore, /node_modules/);
  assert.match(dockerignore, /\.reply-pilot/);
  assert.match(dockerignore, /prompt\.md/);
  assert.match(dockerignore, /\.lark-bridge/);
});

// tests/build-menu-pdf.test.mjs
//
// The menu PDF is built by serving public/ on a loopback port and printing
// the menu page from it. That server hands out files, so it has to hand out
// only the files it is meant to: a request that climbs out of the served
// directory must be refused, including one that hides the climb behind
// percent-encoded slashes.
//
// The gate for this tool is the tool's own tests, because the PDF itself is
// a browser's output and cannot be asserted on.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, resolveRequest, PAGE_TIMEOUT_MS } from "../tools/build-menu-pdf.mjs";

let root;
let server;
let port;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "menu-pdf-"));
  // The served directory, and a sibling whose name starts with the same
  // string — the case a prefix test would let through.
  fs.mkdirSync(path.join(root, "public"));
  fs.mkdirSync(path.join(root, "public-backup"));
  fs.writeFileSync(path.join(root, "public", "menu.html"), "<!doctype html><title>Menu</title>");
  fs.writeFileSync(path.join(root, "public", "index.html"), "<!doctype html><title>Index</title>");
  fs.writeFileSync(path.join(root, "public", "style.css"), "body { color: red; }");
  fs.writeFileSync(path.join(root, "public-backup", "secret.txt"), "not for serving");
  ({ server, port } = await serve(path.join(root, "public")));
});

after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("the build waits a minute for the page", () => {
  assert.equal(PAGE_TIMEOUT_MS, 60000);
});

test("a file inside the served directory is served", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/menu.html`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Menu/);
});

test("the root of the directory serves the index", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Index/);
});

test("a file that is not there is a 404", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/nothing-here.html`);
  assert.equal(response.status, 404);
});

test("a directory is not served as a file", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/assets`);
  assert.equal(response.status, 404);
});

test("a request cannot climb out of the served directory", async () => {
  // The plain climb.
  assert.equal(resolveRequest(path.join(root, "public"), "/../public-backup/secret.txt"), null);
  // The same climb, with the slashes encoded so the URL parser leaves them
  // alone and the decoding happens afterwards.
  assert.equal(resolveRequest(path.join(root, "public"), "/..%2fpublic-backup%2fsecret.txt"), null);
  // And it is refused over the wire, not only in the helper.
  const response = await fetch(`http://127.0.0.1:${port}/..%2fpublic-backup%2fsecret.txt`);
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /not for serving/);
});

test("a file that is served keeps its own type", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/style.css`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/css/);
});

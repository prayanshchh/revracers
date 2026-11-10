import fs from "node:fs";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:4173";
const out = "apps/client/src/school-still.webp";
const width = 2592;
const height = 1080;
const quality = 0.8;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
});
await page.goto(`${base}/`);
await page.waitForSelector("[data-tutorial=root][data-step=welcome]", {
  timeout: 120_000,
});
await page.addStyleTag({
  content:
    "body > :not(canvas) { visibility: hidden !important; transition: none !important; animation: none !important; }",
});
await page.evaluate(
  () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }),
);
const frame = (await page.screenshot({ type: "png" })).toString("base64");
const still = await page.evaluate(
  async ({ png, quality }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.filter = "grayscale(1) brightness(0.75)";
    context.drawImage(image, 0, 0);
    context.filter = "none";
    context.fillStyle = "rgb(8 9 14 / 62%)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/webp", quality);
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  },
  { png: frame, quality },
);
fs.writeFileSync(out, Buffer.from(still, "base64"));
process.stdout.write(`${out}: ${String(fs.statSync(out).size)} bytes\n`);
await browser.close();

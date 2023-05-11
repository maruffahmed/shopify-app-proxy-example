// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify, { storage } from "./shopify.js";
import productCreator from "./product-creator.js";
import GDPRWebhookHandlers from "./gdpr.js";
import { verifyAppProxyExtensionSignature } from "./utils.js";

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();

// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: GDPRWebhookHandlers })
);

// verify app proxy extension signature
const verifyAppProxyExtensionSignatureMiddleware = (_req, res, _next) => {
  if (
    verifyAppProxyExtensionSignature(_req.query, process.env.SHOPIFY_API_SECRET)
  ) {
    return _next();
  }
  res.sendStatus(401);
};

// If you are adding routes outside of the /api path, remember to
// also add a proxy rule for them in web/frontend/vite.config.js

app.get(
  "/api/products-count",
  verifyAppProxyExtensionSignatureMiddleware,
  async (_req, res) => {
    const { shop } = _req.query;

    let sessionId = null;
    let session = null;
    if (shop && typeof shop === "string") {
      sessionId = shopify.api.session.getOfflineId(shop);
      session = await storage.loadSession(sessionId);
      if (session) {
        const countData = await shopify.api.rest.Product.count({
          session,
        });
        return res.status(200).send({
          success: true,
          countData,
        });
      }
    }
    res.status(200).send({
      success: false,
    });
  }
);

// All authenticated session

app.use("/api/*", shopify.validateAuthenticatedSession());

app.use(express.json());

app.get("/api/products/count", async (_req, res) => {
  const countData = await shopify.api.rest.Product.count({
    session: res.locals.shopify.session,
  });
  res.status(200).send(countData);
});

app.get(
  "/api/products/create",
  shopify.validateAuthenticatedSession(),
  async (_req, res) => {
    let status = 200;
    let error = null;

    try {
      await productCreator(res.locals.shopify.session);
    } catch (e) {
      console.log(`Failed to process products/create: ${e.message}`);
      status = 500;
      error = e.message;
    }
    res.status(status).send({ success: status === 200, error });
  }
);

app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(STATIC_PATH, "index.html")));
});

app.listen(PORT);

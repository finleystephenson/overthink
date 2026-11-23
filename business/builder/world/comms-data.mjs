// Node-only: reads the template banks, the staff, the business and the product pictures
// so that deriveComms (which has no Node imports) can run in a browser with the same data.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Picture files for each product id. WHY: company photo posts may only use pictures that exist. */
function listImages(siteDir, productIds) {
  const dir = join(siteDir, "img", "branded");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort() : [];
  const images = {};
  for (const id of productIds) {
    // "blip.jpg", "blip-2.jpg" and "emergency-sandwich-egg.jpg" belong to a product; "acc-..." are accessories.
    images[id] = files
      .filter((f) => !f.startsWith("acc-") && (f === `${id}.jpg` || f.startsWith(`${id}-`)))
      .map((f) => `img/branded/${f}`);
  }
  return images;
}

/**
 * Loads everything deriveComms needs.
 * @param {string} dataDir The project's data folder (for example ".../overthought/data").
 * @returns {object} { mail_customer, mail_system, chat, social, staff, business, products, skuProduct, images }
 */
export function loadCommsData(dataDir) {
  const bank = (name) => readJson(join(dataDir, "comms", `${name}.json`));
  const productsDir = join(dataDir, "products");
  const products = readdirSync(productsDir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const p = readJson(join(productsDir, f));
    // Facts for captions come from the product record, never from a template.
    const prices = (p.variants || []).map((v) => v.price).filter((x) => typeof x === "number");
    return {
      id: p.id, name: p.name, tagline: p.tagline || "", summary: p.summary || "",
      price: prices.length ? Math.min(...prices) : null, multiple_prices: new Set(prices).size > 1,
      features: p.features || [], care: p.care || [], faq: p.faq || [], specs: p.specs || [],
      skus: [...(p.variants || []), ...(p.accessories || [])].map((v) => v.sku),
    };
  });
  const skuProduct = {};
  for (const p of products) for (const sku of p.skus) skuProduct[sku] = { id: p.id, name: p.name };
  return {
    mail_customer: bank("mail_customer"),
    mail_system: bank("mail_system"),
    chat: bank("chat"),
    social: bank("social"),
    banter: bank("banter"),
    junk: bank("junk"),
    staff: readJson(join(dataDir, "staff.json")).staff,
    business: readJson(join(dataDir, "business.json")),
    products,
    skuProduct,
    images: listImages(join(dataDir, "..", "site"), products.map((p) => p.id)),
  };
}

/**
 * Every real product picture a post may use: [{ path, product_id, name }], from the files that exist in business/site/img/branded.
 * The server sets `world.pictures` to this so list_post_pictures and create_social_post agree with the files.
 * @param {string} dataDir The project's data folder.
 * @returns {Array<{path: string, product_id: (string|null), name: string}>}
 */
export function listPictures(dataDir) {
  const data = loadCommsData(dataDir);
  const out = [];
  for (const p of data.products) for (const path of data.images[p.id]) out.push({ path, product_id: p.id, name: p.name });
  const dir = join(dataDir, "..", "site", "img", "branded");
  for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.startsWith("acc-") && x.endsWith(".jpg")).sort() : []) {
    const owner = data.products.find((p) => f.startsWith(`acc-${p.id.split("-")[0]}`));
    out.push({ path: `img/branded/${f}`, product_id: owner ? owner.id : null, name: owner ? `${owner.name} accessory` : f.slice(4, -4) });
  }
  return out;
}

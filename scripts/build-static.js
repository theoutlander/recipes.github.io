import { buildStaticSite } from "../static-site.js";

const result = buildStaticSite({ siteUrl: process.env.SITE_URL || "" });
process.stdout.write(`Built ${result.count} recipe page(s).\n`);

# Publishing your own copy

This file is for whoever puts a copy of this repository on GitHub, not for the labs that deploy it.

The repository address is written in four places: the "Deploy to Cloudflare" button in `README.md` and `README.it.md`, the
`repository` field of `package.json`, and `PRODUCT_URL` in `src/product.js` (the repository address; the credit line and `PRODUCT_SITE` are not changed). In the source of the template the account in that address is the
placeholder `OWNER`. In a copy that someone else already published, it is the account of that person. In both cases it is not yours yet.

1. Put the repository under your own GitHub account or organisation.
2. Write your account in the four places:

   ```
   node scripts/set-owner.mjs <github-account>
   ```

   It replaces whatever account stands in `github.com/<account>/approdo` (`OWNER` or the account of whoever published the copy you
   forked) with yours, in `README.md`, `README.it.md`, `package.json` and `src/product.js`. If the "for whoever publishes" comment is
   still at the top of the two READMEs, it removes it. You can run it again, with the same account or with another one: it
   only writes the account you give.
3. Run the three test suites (`npm run test:all`); they accept any single account name used consistently in those four places.
4. Commit and push. The button of the README now deploys your public copy.

The two other addresses in `src/product.js`, `PRODUCT_SITE` (the product website, the target of the "Made with Approdo by nerln" line) and
`USAGE_URL` (the collector of the anonymous usage count), belong to the author of Approdo: `scripts/set-owner.mjs` does not touch them.
So a lab that deploys your copy reports to the author's collector and is counted on the Approdo website, unless it sets `usageCount: false`. To collect your own count, deploy `stats-collector/` and change `USAGE_URL` in `src/product.js`.

Nothing else in the repository names an owner. The code is under the Attribution Assurance License (`LICENSE`): the BSD terms plus a
visible credit to the author. A published copy keeps `LICENSE` as it is and keeps the footer line "Made with Approdo by nerln" with its
link, also when the copy has another name: that line is the attribution the licence asks for. The landing-page photo has its own licence (`CREDITS.md`).

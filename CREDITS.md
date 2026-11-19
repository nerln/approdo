# Credits

## The photograph `public/quest3.webp`

The headset picture on the landing page is **not** covered by the licence of the code (`LICENSE`). It is a separate work with a separate licence from the code:

- Original: "Meta Quest 3 front View.jpg" by the Wikimedia Commons user Roy.wonder.cohen, <https://commons.wikimedia.org/wiki/File:Meta_Quest_3_front_View.jpg>
- Licence: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), <https://creativecommons.org/licenses/by-sa/4.0/>
- Changes: cropped and converted to WebP (`public/quest3.webp`, 1040 x 551 pixels).

CC BY-SA 4.0 asks you to give credit, link the licence and say that the picture was edited, and to share any adaptation of the
picture under the same licence. The credit line under the landing page does this (it is `hero.creditHtml` in `site.config.js`).
The licence of the code does not extend to the picture, and the licence of the picture does not extend to the code.

### Replacing the picture

Your lab will probably want its own photograph:

1. Put your image in `public/` (for example `public/lab.webp`; letters, digits, `.`, `-`, `_` only).
2. In `site.config.js` set `hero.image` to `"/lab.webp"` and `hero.width` and `hero.height` to its size in pixels.
3. Set `hero.creditHtml` to your own credit line (one text per language), or to `null` if your picture needs none.
4. Delete `public/quest3.webp` and this section if you no longer ship it. Once it is gone from your repository you owe no credit for it.

## Software

The site has no runtime dependency: it uses only what Cloudflare Workers provides. For development it uses
[Wrangler](https://github.com/cloudflare/workers-sdk) (Apache-2.0 / MIT) and, for the optional poster, the
[qrcode](https://github.com/soldair/node-qrcode) package (MIT).

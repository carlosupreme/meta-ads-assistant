import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byFormat, byTimeBlock, byWeekday, postEngagement, postFindings, summarizePosts, topPosts } from "../lib/posts.ts";
import type { PagePost } from "../lib/types.ts";

const now = new Date("2026-09-18T18:00:00Z");

const post = (overrides: Partial<PagePost> = {}): PagePost => ({
  id: `p-${Math.random()}`,
  pageId: "page-1",
  message: "Uniformes nuevos",
  // 20:00 UTC is 14:00 in Mexico City.
  createdAt: "2026-09-15T20:00:00Z",
  format: "photo",
  reactions: 10,
  comments: 2,
  shares: 1,
  ...overrides,
});

describe("organic posts", () => {
  it("adds up interactions and the engagement rate", () => {
    const stats = summarizePosts([post(), post({ reactions: 30, comments: 8, shares: 4, reach: 1000 })]);
    assert.equal(stats.posts, 2);
    assert.equal(stats.engagement, 55);
    assert.equal(stats.averageEngagement, 27.5);
    assert.equal(stats.engagementRate, 0.055);
    assert.equal(postEngagement(post()), 13);
  });

  it("groups by Mexico City weekday, time block and format, best average first", () => {
    const posts = [
      post({ createdAt: "2026-09-15T20:00:00Z", reactions: 100 }),
      post({ createdAt: "2026-09-15T21:00:00Z", reactions: 80 }),
      // 02:00 UTC on Monday is still 20:00 Sunday in Mexico City.
      post({ createdAt: "2026-09-14T02:00:00Z", reactions: 5, format: "status" }),
    ];
    assert.deepEqual(byWeekday(posts).map((item) => [item.label, item.posts]), [["Martes", 2], ["Domingo", 1]]);
    assert.deepEqual(byTimeBlock(posts).map((item) => item.label), ["Mediodía (12–14 h)", "Tarde (15–19 h)", "Noche (20–23 h)"]);
    assert.deepEqual(byFormat(posts).map((item) => [item.label, Math.round(item.average)]), [["Foto", 93], ["Solo texto", 8]]);
    assert.equal(topPosts(posts, 1)[0].reactions, 100);
  });

  it("finds the silence, the best moment and the weak formats", () => {
    const quiet = postFindings([post({ createdAt: "2026-08-01T20:00:00Z" })], now);
    assert.match(quiet[0].title, /días sin publicar/);
    assert.equal(quiet[0].kind, "warn");

    const texts = Array.from({ length: 6 }, (_, index) => post({ id: `t${index}`, format: "status", reactions: 1, comments: 0, shares: 0 }));
    const findings = postFindings([...texts, post(), post()], now);
    assert.ok(findings.some((finding) => finding.title.includes("sin foto ni video")));
  });

  it("says something useful when there is nothing yet", () => {
    assert.equal(postFindings([], now)[0].title, "Aún no hay publicaciones");
  });
});

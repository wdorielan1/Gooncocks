"""
Posts a short message into a Discord channel via a webhook - no bot, no
Discord app needed. Uses only the Python standard library (urllib).

To get a webhook URL: in Discord, go to the target channel's Settings ->
Integrations -> Webhooks -> New Webhook, then copy its URL. Keep that URL
secret - anyone with it can post into that channel.
"""
import json
import urllib.request


def post_message(webhook_url, content):
    """Posts a single message. Discord caps messages at 2000 characters -
    this doesn't chunk long text, so keep messages short (a headline +
    a link works well) and put the full recap on the webpage instead."""
    body = json.dumps({"content": content}).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        resp.read()


def build_teaser(week, awards, page_url=None):
    """A short, shareable message for the chat - the headline award plus
    a link to the full recap page, not the whole recap dumped as text."""
    g = awards["goon"]
    c = awards["cock"]
    lines = [
        f"Week {week} recap is up.",
        f"Goon of the Week: {g['team']} ({g['score']:.2f} pts, +$50)",
        f"Cock of the Week: {c['team']} ({c['score']:.2f} pts)",
    ]
    if page_url:
        lines.append(page_url)
    return "\n".join(lines)

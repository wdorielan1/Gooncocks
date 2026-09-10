#!/usr/bin/env python3
"""
Turns your Yahoo app's Client ID/Secret into a refresh token you can reuse
forever (Yahoo refresh tokens don't expire just from sitting unused).

Run this AFTER creating a Yahoo app at https://developer.yahoo.com/apps/
with API Permission "Fantasy Sports - Read" and Redirect URI set to the
literal text "oob".

Two steps, run as two separate commands (this keeps it usable both from a
real interactive terminal and one command at a time, e.g. when someone is
running these commands on your behalf):

  1) python3 get_refresh_token.py url
       -> prints the Yahoo login link to open in a browser.
          Needs YAHOO_CLIENT_ID set.

  2) python3 get_refresh_token.py exchange PASTE_THE_CODE_HERE
       -> trades that code for a refresh token.
          Needs YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET set.
"""
import argparse
import os
import sys

from yahoo_client import build_authorize_url, exchange_code_for_tokens


def require_env(name):
    value = os.environ.get(name)
    if not value:
        print(f"Missing required environment variable: {name}")
        sys.exit(1)
    return value


def cmd_url(_args):
    client_id = require_env("YAHOO_CLIENT_ID")
    url = build_authorize_url(client_id)
    print()
    print("Open this URL, log into Yahoo, and click 'Agree':")
    print()
    print(f"  {url}")
    print()
    print("Yahoo will show you a short code on screen after you approve access.")
    print("Then run: python3 get_refresh_token.py exchange <that code>")


def cmd_exchange(args):
    client_id = require_env("YAHOO_CLIENT_ID")
    client_secret = require_env("YAHOO_CLIENT_SECRET")

    try:
        tokens = exchange_code_for_tokens(client_id, client_secret, args.code)
    except Exception as exc:
        print(f"\nSomething went wrong exchanging the code for tokens: {exc}")
        sys.exit(1)

    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        print(f"\nYahoo did not return a refresh_token. Full response:\n{tokens}")
        sys.exit(1)

    print()
    print("Success! Here is your refresh token:")
    print()
    print(f"  {refresh_token}")
    print()
    print("Keep this somewhere safe - it's the key to your Yahoo fantasy data.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("url", help="Print the Yahoo login link").set_defaults(func=cmd_url)

    exchange_parser = sub.add_parser("exchange", help="Trade a login code for a refresh token")
    exchange_parser.add_argument("code", help="The code Yahoo showed you after login")
    exchange_parser.set_defaults(func=cmd_exchange)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

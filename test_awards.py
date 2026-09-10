#!/usr/bin/env python3
"""
Prints a sample recap using made-up data - no Yahoo account, no internet
connection, and no environment variables needed. Run this first to confirm
the recap format looks right before touching any real API credentials.
"""
from awards import generate_recap
from sample_data import SAMPLE_MATCHUPS

if __name__ == "__main__":
    print(generate_recap(week=1, matchups=SAMPLE_MATCHUPS))

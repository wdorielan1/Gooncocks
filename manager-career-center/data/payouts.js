/*
 * League payout rules by season, as described by the commissioner. The
 * Career Center estimates everyone's winnings from these rules and each
 * season's final Yahoo standings; there are no payment records behind it.
 *
 * Usual split: 2nd place doubles their buy-in, 3rd gets their buy-in back,
 * and 1st takes the rest of the pot (buy-in x number of teams).
 * 2026 is the exception: a fixed $1,200 / $400 for 1st / 2nd, no 3rd-place
 * payout, and the first year of $50 Goon of the Week payouts.
 *
 * "confirmed": the buy-in for that year was given directly.
 * Seasons not listed use DEFAULT (buy-ins were "normally $150 to $200";
 * $150 is used because it was the most common), marked as estimates.
 * Edit this file to correct any year - every view recalculates from it.
 */
window.GOONCOCKS_PAYOUTS = {
  currency: 'USD',
  seasons: {
    2026: { buyIn: 225, first: 1200, second: 400, third: 0, goonWeekly: 50, confirmed: true },
    2025: { buyIn: 150, confirmed: true },
    2024: { buyIn: 200, confirmed: true },
    2023: { buyIn: 150, confirmed: true },
    2022: { buyIn: 150, confirmed: true },
    2021: { buyIn: 150, confirmed: true }
  },
  DEFAULT: { buyIn: 150, confirmed: false }
};

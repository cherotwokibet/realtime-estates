# Exact search boundaries in both company pilots

Checkpoint 442, 18 November 2026 EAT. Seven filter combinations now run against the connected search API in each company pilot. The published studio had zero bedrooms and monthly rent of KES 20,000.01. Equal inclusive bounds found it. A strict minimum at the price excluded it, and a strict minimum one cent below included it. A maximum one cent below excluded it. A different property type, one bedroom and daily rent each excluded the studio.

The integrated test also verified that the valid filters reached the connected search path. Both synthetic companies passed all three pilot checks. The separate web catalogue suite passed all 55 tests. An initial combined command used the React server condition for the browser-oriented catalogue test and could not load its hooks. Running each suite with its supported condition resolved the test runner error.

Next review the exact price and zero-bedroom filters with a Realtime operator in the browser walkthrough, then verify mobile search and enquiry behaviour on an installed Android device. Tasks 12-3 and 12-7 remain open.

[Pilot tests](pilot442-checks.txt) · [Catalogue tests](pilot442-catalogue.txt)

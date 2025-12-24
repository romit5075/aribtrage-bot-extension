
# Team Name Matching Logic

The matching system uses a weighted point-scoring algorithm (0-100+) to determine if two team names refer to the same entity. A score of **40 or higher** is considered a match.

## 1. Strict Mode (If Enabled)
- If strict mode is ON, teams must match exactly (ignoring case/whitespace). The fuzzy rules below are skipped.

## 2. Fuzzy Matching Rules (Default)
If `strictMatch` is OFF, the system calculates a compatibility score between **Team A (Poly)** and **Team B (Stake)** based on the following criteria:

### A. Cleaning & Deduplication
- **Clean**: Removes special characters (`[^A-Z0-9 ]`), reduces multiple spaces to one.
- **Dedupe**: If a name repeats ("33 33"), it's reduced to "33".

### B. Scoring Rules (Add points if rule passes)

1.  **Exact Substring (60 pts)**: One name is contained within the other.
    *   *e.g., "TEAM ONE" contains "ONE"*
2.  **Prefix Match (30 pts)**: Both names start with the same First Word (min 2 chars).
    *   *e.g., "NAVI Junior" vs "NAVI"*
3.  **Numeric Match (60 pts)**: If the first word is a number, and it matches.
    *   *e.g., "33" matches "33 TEAM"*
4.  **Token Overlap (20 pts per match)**: Counts how many words (tokens) appear in both names.
    *   *e.g., "G2 ESPORTS" vs "G2"* -> "G2" matches.
    *   **Strong Token Bonus (+20 pts)**: If matching token is >3 chars long.
5.  **Number-Based Main Match (50 pts)**: If the name starts with the same number.
    *   *e.g., "100 THIEVES" vs "100T"* (via numeric extraction)
6.  **Core Name Match (55 pts)**: Extracts "Core" name (removes prefixes like G1/T1/Team/Esports).
    *   *e.g., "GENONE" matches "G1 GENONE"*
7.  **Short Prefix (60 pts)**: If one name is short (2-3 chars) and appears at the start of the other.
    *   *e.g., "G1" matches "G1 GENONE"*
8.  **Ticker/Main Name Match (45-70 pts)**: Removes short "tickers" (first word <= 5 chars) and compares the rest.
    *   *e.g., "FAZE CLAN" vs "CLAN"* (Matches main name)
9.  **Abbreviation / Acronym (45-70 pts)**:
    *   **Standard**: Acronym matches chars in order.
    *   **G1/T1 Style**: Checks if short name is like "G1" and long name is like "GENONE" (First letter + Number as word).
        *   "G1" matches "GEN ONE" / "GENONE"
        *   "T1" matches "TEAM ONE" / "TEAMONE"
    *   **Known Abbreviations**: Hardcoded list (e.g., "33" -> "THIRTYTHREE").

### C. Penalties
- If strict mode is OFF but names are not identical, a small **-10 confidence penalty** is applied visually (but effectively ignored as long as score > 40).

### D. Final Decision
- The system iterates through all potential matches in the Stake list for a given Poly team.
- The candidate with the **highest score** is selected.
- If the best score is **>= 40**, it is a MATCH.

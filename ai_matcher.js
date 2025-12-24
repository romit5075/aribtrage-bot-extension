class GeminiMatcher {
    constructor() {
        this.apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
    }

    async verifyMatch(teamA, teamB, apiKey) {
        if (!apiKey) return 'SKIPPED';

        const prompt = `
You are a specialized sports data matching assistant. Your sole task is to determine if two team names refer to the SAME competitive entity or DIFFERENT entities.

Apply these specific rules for edge cases:
1. Translated/Localized: "Red Star" == "Crvena Zvezda" (SAME)
2. Historical/Rebranded: "Team Liquid" == "Liquid" (SAME)
3. Sponsor Pollution: "NaVi Monster Energy" == "NaVi" (SAME)
4. Academy/Youth: "G2 Academy" vs "G2" (DIFFERENT)
5. Gendered Teams: "Team Liquid Women" vs "Team Liquid" (DIFFERENT)
6. Region Suffixes: "Team Secret EU" == "Team Secret" (SAME if main roster implication, usually SAME)
7. Stylized/Phonetic: "Thr33" == "Three" (SAME)
8. Mascot vs Org: "Wolves" == "Team Wolves" (SAME)
9. Abbreviation Collisions: "G2" vs "G2 Arctic" (DIFFERENT)
10. Event Names: "NaVi Showmatch" vs "NaVi" (SAME entity, but check context - usually SAME for arbitrage purposes if it's the main team playing)

Team A: "${teamA}"
Team B: "${teamB}"

Answer ONLY "SAME" or "DIFFERENT".
`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

            const response = await fetch(`${this.apiUrl}?key=${apiKey}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }]
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await response.json();

            if (data.error) {
                console.error("Gemini API Error:", data.error);
                return 'ERROR';
            }

            const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();

            if (answer && answer.includes('SAME')) return 'SAME';
            if (answer && answer.includes('DIFFERENT')) return 'DIFFERENT';

            return 'UNCERTAIN';

        } catch (error) {
            console.error("Gemini Network Error:", error);
            return 'ERROR';
        }
    }
}

// Make it globally available
window.geminiMatcher = new GeminiMatcher();

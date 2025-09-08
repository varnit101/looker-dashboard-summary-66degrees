const express = require('express');
const app = express();
const cors = require('cors');
const http = require('http');
const server = http.createServer(app);
const fetch = require('node-fetch'); // Import node-fetch
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
dotenv.config();

const storedClientSecret = process.env.GENAI_CLIENT_SECRET;
const PROJECT_ID = process.env.PROJECT;
const REGION = process.env.REGION || 'us-central1'; // Default region
const MODEL_ID = process.env.MODEL_ID || 'gemini-2.0-flash'; // Default model, now from env
const API_ENDPOINT = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL_ID}:generateContent`;

app.use(express.json());
app.use(cors());

const writeStructuredLog = (message) => {
    return {
        severity: 'INFO',
        message: message,
        component: 'dashboard-summarization-logs',
    };
};

// Middleware to verify client secret
const verifyClientSecret = (req, res, next) => {
    const clientSecret = req.body.client_secret;
    if (clientSecret === storedClientSecret) {
        next();
    } else {
        res.status(403).send('Forbidden: Invalid client secret');
    }
};

// Helper function to get Google Cloud access token
async function getAccessToken() {
    try {
        const { GoogleAuth } = require('google-auth-library');
        const auth = new GoogleAuth({
            scopes: 'https://www.googleapis.com/auth/cloud-platform',
        });
        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();
        return accessToken.token;
    } catch (error) {
        console.error('Error getting access token:', error);
        throw error; // Re-throw to be caught by caller
    }
}

// --- API Endpoint Handlers (using REST API) ---

app.post('/generateQuerySummary', verifyClientSecret, async (req, res) => {
    const { query, description, nextStepsInstructions } = req.body;
    try {
        const summary = await generateQuerySummary(query, description, nextStepsInstructions);
        res.json({ summary });
    } catch (e) {
        console.error('Error in /generateQuerySummary:', e);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/generateSummary', verifyClientSecret, async (req, res) => {
    const { querySummaries, nextStepsInstructions } = req.body;
    try {
        const summary = await generateSummary(querySummaries, nextStepsInstructions);
        res.json({ summary });
    } catch (e) {
        console.error('Error in /generateSummary:', e);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/generateQuerySuggestions', verifyClientSecret, async (req, res) => {
    const { queryResults, querySummaries, nextStepsInstructions } = req.body;
    try {
        const suggestions = await generateQuerySuggestions(queryResults, querySummaries, nextStepsInstructions);
        res.json({ suggestions });
    } catch (e) {
        console.error('Error in /generateQuerySuggestions:', e);
        res.status(500).send('Internal Server Error');
    }
});

// --- Helper Functions (using REST API) ---

async function generateQuerySummary(query, description, nextStepsInstructions) {
    const accessToken = await getAccessToken();
    const prompt = {
        contents: [{
            role: 'user',
            parts: [{
                text: getQuerySummaryPrompt(query, description, nextStepsInstructions)
            }]
        }]
    };

    const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(prompt),
    });

    if (!response.ok) {
        const errorText = await response.text(); // Get error message
        throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }
    const data = await response.json();

    if (data.error) {
        throw new Error(`Vertex AI API error: ${data.error.message}`);
    }

    return data.candidates[0]?.content?.parts[0]?.text || '';
}

function getQuerySummaryPrompt(query, description, nextStepsInstructions) {
    const queryPrompt = `
    You are an expert Looker dashboard analyst tasked with summarizing dashboard queries and providing actionable next steps in Markdown format.

    **Strict Formatting and Content Requirements:**

    * **Markdown Output:** All responses must be formatted using Markdown. Supported elements include headings, bold, italic, links, tables, lists, code blocks, and blockquotes.
    * **No Images:** Do not include or attempt to render images.
    * **Numerical Formatting:** Format numerical values as percentages or dollar amounts (rounded to the nearest cent).
    * **No Indentation:** Do not indent any part of your response.
    * **Query-Specific Sections:** Each dashboard query summary should adhere to the following structure, starting on a new line:
        * \`## Query Name\`: Use the "Query Title" from the provided context.
        * \`Description\`: A concise (2-4 sentences) paragraph describing the query.
        * \`> Summary\`: A blockquote (3-5 sentences) summarizing the query results for user comprehension.
        * \`## Next Steps\`: A bulleted list of 2-3 actionable next steps based on the query summary.
    * **Newlines and Dividers:** Each query summary must start on a new line and end with a horizontal divider (\`---\`).

    **Context:**
    
    Summary style/specialized instructions: ${nextStepsInstructions || ''}
    Dashboard Detail: ${description || ''} 

    Query Details: "Query Title: ${query.title} 
    ${query.note_text !== '' && query.note_text !== null ? "Query Note: " + query.note_text : ''} 
    Query Fields: ${query.queryBody.fields} 
    Query Data: ${JSON.stringify(query.queryData)}"

    **Example Output (Use as a Template, Not Verbatim):**

    \`\`\`markdown
    ## Web Traffic Over Time

    This query details the amount of web traffic received to the website over the past 6 months. It includes a web traffic source field of organic, search, and display, as well as an amount field detailing the number of users from those sources.

    > It appears that search has consistently driven the highest user traffic, with 9875 users in the past month and a peak in December at 1000 unique users. Organic traffic is the second highest, while display traffic is significantly lower. Display traffic started strong but declined steadily. There was a notable 23% spike in organic traffic in March.

    ## Next Steps
    * Investigate the 23% organic traffic spike in March to identify potential causes (e.g., marketing campaign, website error).
    * Segment search traffic by campaign source to identify high-performing strategies.
    * Analyze display traffic patterns to determine the factors contributing to its decline and explore optimization strategies.
    ---
    \`\`\`
    `;
    return queryPrompt;
}


async function generateSummary(querySummaries, nextStepsInstructions) {
    const accessToken = await getAccessToken();
    const finalPromptData = `
    You are a specialized answering assistant that can summarize a Looker dashboard and the underlying data and propose operational next steps drawing conclusions from the Query Details listed above. Follow the instructions below:

    Please highlight the findings of all of the query data here. All responses MUST be based on the actual information returned by these queries: \n                                     
    data: ${querySummaries.join('\n')}

    For example, use the names of the locations in the data series (like Seattle, Indianapolis, Chicago, etc) in recommendations regarding locations. Use the name of a process if discussing processes. Don't use row numbers to refer to any facility, process or location. This information should be sourced from the above data.
    Surface the most important or notable details and combine next steps recommendations into one bulleted list of 2-6 suggestions. \n
    --------------
    Here is an output format Example:
    ----------------
    
    ## Web Traffic Over Time \n
    This query details the amount of web traffic received to the website over the past 6 months. It includes a web traffic source field of organic, search and display
    as well as an amount field detailing the amount of people coming from those sources to the website. \n
    
    > It looks like search historically has been driving the most user traffic with 9875 users over the past month with peak traffic happening in december at 1000 unique users.
    Organic comes in second and display a distant 3rd. It seems that display got off to a decent start in the year, but has decreased in volume consistently into the end of the year.
    There appears to be a large spike in organic traffic during the month of March a 23% increase from the rest of the year.\n
    \n
    
    ## Next Steps
    * Look into the data for the month of March to determine if there was an issue in reporting and/or what sort of local events could have caused the spike
    * Continue investing into search advertisement with common digital marketing strategies. IT would also be good to identify/breakdown this number by campaign source and see what strategies have been working well for Search.
    * Display seems to be dropping off and variable. Use only during select months and optimize for heavily trafficed areas with a good demographic for the site retention.\n
    \n
    -----------

    Please add actionable next steps, both for immediate intervention, improved data gathering and further analysis of existing data.
    Here are some tips for creating actionable next steps: \n
    -----------
    ${nextStepsInstructions}
    -----------
    
    `;
    const prompt = {
        contents: [{ role: 'user', parts: [{ text: finalPromptData }] }]
    };
    const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(prompt),
    });

    if (!response.ok) {
          const errorText = await response.text();
        throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
      if (data.error) {
        throw new Error(`Vertex AI API error: ${data.error.message}`);
    }
    return data.candidates[0]?.content?.parts[0]?.text || '';
}



async function generateQuerySuggestions(queryResults, querySummaries, nextStepsInstructions) {
    const accessToken = await getAccessToken();
    const querySuggestionsPromptData = `
    You are an expert Looker analyst tasked with generating actionable next-step investigation queries in JSON format.

    Your goal is to provide a JSON array of strings, where each string represents a potential Looker query or data exploration suggestion. These suggestions should directly address the "next steps" in analysis, guided by the following criteria:

    * **Actionable and Looker-Executable:** Queries must be feasible within the Looker platform.
    * **Targeted Investigation:** Queries should build upon the provided queryResults and querySummaries, avoiding repetition of existing analyses.
    * **Alignment with Next Steps:** Queries must directly relate to the analytical "next steps" outlined in \`${nextStepsInstructions}\` and the context provided within \`${querySummaries}\`.
    * **Date Filtering:** Include a date filter in every query. If a relevant date range isn't specified in the context, default to the "last 30 days."

    Here's the data context:

    * **Current Data:** \`${queryResults}\`
    * **Previous Analysis and Next Steps:** \`${querySummaries}\`
    * **Next Step Instructions:** \`${nextStepsInstructions}\`

    Output Format:

    Provide your response in the following JSON format, containing exactly three querySuggestion elements:

    \`\`\`json
    [
        {"querySuggestion": "Show me the top XXX entries for YYY on October 13th, 2024"},
        {"querySuggestion": "What are the lowest values for ZZZ, grouped by AAA, in the last 30 days?"},
        {"querySuggestion": "What is the productivity and standard deviation for the XXX facility for the past 3 months?"}
    ]
    \`\`\`
    `;

    const prompt = {
        contents: [{ role: 'user', parts: [{ text: querySuggestionsPromptData }] }]
    };
    const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(prompt),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }
    const data = await response.json();
      if (data.error) {
        throw new Error(`Vertex AI API error: ${data.error.message}`);
    }
    return data.candidates[0]?.content?.parts[0]?.text || '';
}

const PORT = process.env.PORT ? process.env.PORT : 5000;

server.listen(PORT, () => {
    console.log("Listening on: ", PORT);
});

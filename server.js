const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const helpRequests = [];

const offlineResources = [
  {
    title: 'Nearby Shelters',
    description: 'Community halls, schools and places of worship can serve as safe shelter points.',
    contact: 'Call local emergency support at 112 or municipal helpline.'
  },
  {
    title: 'Mobility Support',
    description: 'Request wheelchair pickup, ramps, and safe transfer support for elders and disabled people.',
    contact: 'Use the in-app help request to alert volunteers quickly.'
  },
  {
    title: 'Food & Medicine',
    description: 'Share ration, nutrition, medicine refill, and nearby low-cost clinic needs.',
    contact: 'AshaBot can generate a simple request text in one click.'
  }
];

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error('Request too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function callGenAI(prompt, language, tone) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!key) {
    return {
      answer: localAssistantReply(prompt, language, tone),
      source: 'offline'
    };
  }

  const styleInstruction = tone === 'detailed' ? 'Give 5 practical bullet steps.' : 'Give 3 short practical steps.';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are AshaAid assistant. Help poor families, elderly users, and disabled users in simple compassionate language with accessibility-first instructions.'
        },
        {
          role: 'user',
          content: `Language: ${language}\nTone: ${tone}\nNeed: ${prompt}\n${styleInstruction}`
        }
      ],
      temperature: 0.4,
      max_tokens: 300
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${detail}`);
  }

  const data = await response.json();
  return {
    answer: data.choices?.[0]?.message?.content || localAssistantReply(prompt, language, tone),
    source: 'openai'
  };
}

function localAssistantReply(prompt, language, tone) {
  const normalized = prompt.toLowerCase();
  const detailedSuffix =
    tone === 'detailed'
      ? ' Also keep IDs, prescriptions, and emergency contacts in one pouch and ask for priority for senior/disabled persons.'
      : '';

  let reply =
    'I am with you. Step 1: Share your exact location. Step 2: Tell your top urgent need (food/medicine/shelter/transport). Step 3: Submit volunteer request in this app.';

  if (normalized.includes('food')) {
    reply =
      'Food support plan: 1) Contact nearest community kitchen/NGO. 2) Ask for 7-day ration with baby/senior items. 3) Keep clean drinking water and ORS ready.';
  } else if (normalized.includes('medicine') || normalized.includes('hospital')) {
    reply =
      'Medical support plan: 1) Keep medicine list + prescription ready. 2) Call emergency service if severe symptoms. 3) Ask for wheelchair and fast-track support at clinic.';
  } else if (normalized.includes('shelter') || normalized.includes('home')) {
    reply =
      'Shelter plan: 1) Move to nearest safe public building. 2) Register phone and family count at help desk. 3) Ask for separate area for women, elders and disabled persons.';
  } else if (normalized.includes('read') || normalized.includes('form')) {
    reply =
      'Form support plan: 1) Use voice input and speak one line at a time. 2) Keep photo ID nearby. 3) Ask volunteer to verify each field before submission.';
  }

  const finalReply = `${reply}${detailedSuffix}`;
  if (language === 'hi') return `सहायता योजना: ${finalReply}`;
  return finalReply;
}

function createTicketId() {
  return `ASHA-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function buildRequestStats() {
  const categories = helpRequests.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});

  return {
    total: helpRequests.length,
    urgent: helpRequests.filter((x) => x.urgency === 'urgent' || x.urgency === 'critical').length,
    categories,
    recent: helpRequests.slice(-8).reverse()
  };
}

function serveStaticFile(reqPath, res) {
  const filePath = path.join(PUBLIC_DIR, reqPath === '/' ? 'index.html' : reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const reqPath = decodeURIComponent(parsedUrl.pathname);

  if (req.method === 'GET' && reqPath === '/api/resources') {
    return sendJson(res, 200, { resources: offlineResources });
  }

  if (req.method === 'GET' && reqPath === '/api/requests') {
    return sendJson(res, 200, buildRequestStats());
  }

  if (req.method === 'POST' && reqPath === '/api/request-help') {
    try {
      const body = JSON.parse((await readRequestBody(req)) || '{}');
      const location = String(body.location || '').trim();
      if (!location) {
        return sendJson(res, 400, { error: 'Location is required' });
      }

      const ticketId = createTicketId();
      const requestEntry = {
        ticketId,
        name: String(body.name || 'Anonymous').trim(),
        phone: String(body.phone || '').trim(),
        location,
        category: String(body.category || 'other').trim(),
        urgency: String(body.urgency || 'normal').trim(),
        notes: String(body.notes || '').trim(),
        createdAt: new Date().toISOString()
      };

      helpRequests.push(requestEntry);

      const etaMinutes = requestEntry.urgency === 'critical' ? 12 : requestEntry.urgency === 'urgent' ? 25 : 45;
      return sendJson(res, 201, { ticketId, etaMinutes });
    } catch (error) {
      return sendJson(res, 500, { error: 'Could not submit help request', detail: error.message });
    }
  }

  if (req.method === 'POST' && reqPath === '/api/assistant') {
    try {
      const body = JSON.parse((await readRequestBody(req)) || '{}');
      const prompt = String(body.prompt || '').trim();
      const language = body.language === 'hi' ? 'hi' : 'en';
      const tone = body.tone === 'detailed' ? 'detailed' : 'simple';

      if (!prompt) {
        return sendJson(res, 400, { error: 'Prompt is required' });
      }

      const result = await callGenAI(prompt, language, tone);
      return sendJson(res, 200, result);
    } catch (error) {
      return sendJson(res, 500, {
        error: 'Failed to process assistant request',
        detail: error.message
      });
    }
  }

  if (req.method === 'GET') {
    return serveStaticFile(reqPath, res);
  }

  res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
});

server.listen(PORT, () => {
  console.log(`AshaAid running on http://localhost:${PORT}`);
});

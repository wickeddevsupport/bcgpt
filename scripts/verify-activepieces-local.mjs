const baseUrl = process.env.AP_LOCAL_BASE_URL ?? 'http://localhost:8080';
const expectedWebsiteName = process.env.AP_EXPECTED_WEBSITE_NAME ?? 'Wicked Flow';
const requiredPieces = ['@activepieces/piece-bcgpt', '@activepieces/piece-basecamp'];

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main() {
  const flags = await fetchJson('/api/v1/flags');
  const pieces = await fetchJson('/api/v1/pieces');

  const themeName = flags?.THEME?.websiteName ?? '';
  const favIcon = flags?.THEME?.logos?.favIconUrl ?? '';
  const pieceNames = Array.isArray(pieces) ? pieces.map((piece) => String(piece?.name ?? '')) : [];
  const missing = requiredPieces.filter((pieceName) => !pieceNames.includes(pieceName));

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Theme websiteName: ${themeName}`);
  console.log(`Theme favIconUrl: ${favIcon}`);
  console.log(`Pieces count: ${pieceNames.length}`);
  console.log(`Contains ${requiredPieces[0]}: ${pieceNames.includes(requiredPieces[0])}`);
  console.log(`Contains ${requiredPieces[1]}: ${pieceNames.includes(requiredPieces[1])}`);

  const errors = [];
  if (themeName !== expectedWebsiteName) {
    errors.push(`Expected THEME.websiteName='${expectedWebsiteName}', got '${themeName}'`);
  }
  if (missing.length > 0) {
    errors.push(`Missing pieces: ${missing.join(', ')}`);
  }

  if (errors.length > 0) {
    console.error('Verification failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Verification passed.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

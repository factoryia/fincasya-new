import { google } from 'googleapis';
import readline from 'readline';

async function getRefreshToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('ERROR: Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en tu .env.local');
    return;
  }

  // IMPORTANTE: Asegúrate de que esta URL esté en "Redirect URIs" de tu GCP Console
  const REDIRECT_URI = 'http://localhost:3000';

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    REDIRECT_URI
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent' 
  });

  console.log('\n--- PASO 1 ---');
  console.log('Copia esta URL y ábrela en tu navegador:\n');
  console.log(authUrl);
  console.log('\n--- PASO 2 ---');
  console.log('Después de autorizar, la página te llevará a una URL de localhost (o dará error de conexión).');
  console.log('Copia el valor que aparece después de "code=" en la barra de direcciones del navegador.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('\n--- PASO 3 ---\nPega el código aquí: ', async (code) => {
    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log('\n--- ¡ÉXITO! ---');
      console.log('Aquí tienes tu REFRESH TOKEN:\n');
      console.log(tokens.refresh_token);
      console.log('\nCopia ese valor y pégalo aquí en el chat para que yo lo guarde.');
      rl.close();
    } catch (e: any) {
      console.error('\nERROR: No se pudo obtener el token:', e.message);
      rl.close();
    }
  });
}

getRefreshToken();

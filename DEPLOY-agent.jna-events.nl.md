# NOVA live zetten op agent.jna-events.nl

Je WordPress-site op jna-events.nl blijft volledig ongemoeid.
NOVA komt op een apart subdomein: agent.jna-events.nl, gehost via Vercel.
Volg deze vier fases in volgorde. Reken op 30 tot 60 minuten de eerste keer.

Wat je nodig hebt:
- Het uitgepakte project (deze map)
- Een gratis GitHub-account (github.com)
- Een gratis Vercel-account (vercel.com)
- Een Anthropic API-sleutel (console.anthropic.com)
- Toegang tot het DNS-beheer van jna-events.nl bij je hostingprovider

=====================================================================
FASE 1 - Project op GitHub zetten (eenmalig)
=====================================================================

1. Installeer Git als je dat nog niet hebt: https://git-scm.com
2. Maak een account op https://github.com
3. Klik rechtsboven op + en kies "New repository".
   - Naam: jna-nova-agent
   - Zet hem op Private als je wilt
   - Vink NIETS aan (geen README, geen gitignore)
   - Klik "Create repository"
4. GitHub toont nu een adres dat eindigt op .git. Kopieer dat.
5. Open een terminal in deze projectmap en typ (vervang JOUW-NAAM):

   git init
   git add .
   git commit -m "NOVA agent eerste versie"
   git branch -M main
   git remote add origin https://github.com/JOUW-NAAM/jna-nova-agent.git
   git push -u origin main

   Het project staat nu op GitHub.

=====================================================================
FASE 2 - Vercel koppelen
=====================================================================

1. Ga naar https://vercel.com en log in met je GitHub-account.
2. Klik "Add New" -> "Project".
3. Kies je repository jna-nova-agent en klik "Import".
4. Vercel herkent Vite automatisch. NIET op deploy klikken - eerst stap 5.
5. Open "Environment Variables" en voeg toe:
      Name:  ANTHROPIC_API_KEY
      Value: je echte sleutel (begint met sk-ant-...)
6. Klik "Deploy". Na een minuut krijg je een URL zoals
   jna-nova-agent.vercel.app - test deze even, NOVA hoort hier te werken.

=====================================================================
FASE 3 - Subdomein koppelen in Vercel
=====================================================================

1. In Vercel: open je project -> Settings -> Domains.
2. Typ:  agent.jna-events.nl  en klik "Add".
3. Vercel toont nu welk DNS-record je moet aanmaken. Meestal:
      Type:  CNAME
      Naam:  agent
      Waarde: cname.vercel-dns.com
   Laat dit scherm open staan - je hebt deze waarde zo nodig.

=====================================================================
FASE 4 - DNS-record zetten bij je hostingprovider
=====================================================================

1. Log in bij je hostingprovider (waar jna-events.nl staat).
2. Zoek het DNS-beheer of "DNS-records" van jna-events.nl.
   (Bij TransIP: domein -> DNS. Bij Vimexx: DNS-beheer.
    Bij SiteGround: Site Tools -> Domain -> DNS Zone Editor.)
3. Voeg een nieuw record toe met exact de waarden uit Vercel (fase 3):
      Type:  CNAME
      Naam/Host:  agent
      Waarde/Doel: cname.vercel-dns.com
      TTL: laat standaard staan
4. Sla op. Het doorvoeren duurt 10 minuten tot soms een paar uur.
5. Ga terug naar Vercel. Zodra het record gevonden is, verschijnt er een
   groen vinkje bij agent.jna-events.nl. Vercel regelt automatisch https.

KLAAR. NOVA draait nu op https://agent.jna-events.nl

=====================================================================
In WordPress een knop naar NOVA zetten
=====================================================================

Wil je vanaf je gewone site naar NOVA kunnen?
- WordPress -> Weergave -> Menu's -> "Aangepaste link"
  URL: https://agent.jna-events.nl   Tekst: NOVA / AI-assistent
- Of plaats ergens op een pagina een knop die naar die URL linkt.

=====================================================================
Verbeteringen later live zetten
=====================================================================

Na de eenmalige setup is elke wijziging maar 1 commando:

   npm run push

Dat commit en pusht naar GitHub. Vercel zet de nieuwe versie binnen een
minuut vanzelf live op agent.jna-events.nl.

=====================================================================
Belangrijk over je API-sleutel en kosten
=====================================================================

- Je sleutel staat ALLEEN in Vercel (Environment Variables), nooit in de code.
- Elk gesprek met NOVA kost een klein bedrag via je Anthropic-account.
- Omdat de pagina openbaar is, kan in principe iedereen NOVA gebruiken en
  dus je tegoed verbruiken. Overweeg een simpele toegangsbeveiliging
  (wachtwoord) voordat je de link breed deelt. Vraag hierom als je dat wilt.

=====================================================================
TOEGANGSBEVEILIGING (wachtwoord)
=====================================================================

NOVA staat nu achter een wachtwoordscherm. Niemand kan de agent gebruiken
(en dus jouw API-tegoed verbruiken) zonder het wachtwoord.

Instellen in Vercel:
1. Settings > Environment Variables
2. Voeg toe:
      Naam:  NOVA_PASSWORD
      Waarde: een sterk wachtwoord naar keuze (deel dit alleen met je team)
3. Voeg ook toe (voor extra veiligheid van de sessie):
      Naam:  NOVA_SECRET
      Waarde: een lange willekeurige tekst (bijv. 30+ tekens, maakt niet uit wat)
4. Beide op scope Production.
5. Deploy opnieuw ZONDER build-cache (Deployments > ... > Redeploy,
   vinkje "Use existing Build Cache" UIT).

Vanaf nu: bezoekers zien eerst een wachtwoordscherm. Na het juiste wachtwoord
blijven ze 30 dagen ingelogd (op dat apparaat). Rechtsboven zit een uitlog-knop.

Wachtwoord wijzigen? Pas NOVA_PASSWORD aan in Vercel en deploy opnieuw.

=====================================================================
VERBETERLIJST BLIJVEND BEWAREN (optioneel maar aanbevolen)
=====================================================================

NOVA verzamelt zelf verbeterpunten (de knop "Verbeteringen" rechtsboven).
Standaard worden die alleen tijdens de serversessie bewaard. Wil je ze
ECHT blijvend bewaren (ook na herstart), koppel dan gratis Vercel KV:

1. Vercel project > tabblad Storage > Create Database > kies "KV".
2. Klik Connect en koppel hem aan je project.
3. Vercel zet dan automatisch KV_REST_API_URL en KV_REST_API_TOKEN klaar.
4. Deploy opnieuw zonder build-cache.

Zonder deze stap werkt de verbeterlijst gewoon, maar wordt hij niet
permanent bewaard tussen serverherstarts.

Hoe je de lijst gebruikt:
- NOVA voegt zelf punten toe als haar iets opvalt dat beter kan.
- Open de lijst via de knop "Verbeteringen" rechtsboven.
- Klik "Kopieer voor Claude" en plak de lijst in een nieuw gesprek met
  Claude. Vraag om de punten te verwerken in een update. Daarna push je
  de nieuwe code met: npm run push

=====================================================================
JE NAAM IN DE BEGROETING
=====================================================================

NOVA begroet je bij het inloggen met "Goedemorgen/middag/avond, [naam],
welkom terug." Vul je naam in via een variabele in Vercel:

1. Settings > Environment Variables
2. Voeg toe:
      Naam:  VITE_NOVA_NAME
      Waarde: je voornaam (bijv. Jordi)
   Scope: Production. (De VITE_ vooraan is verplicht, anders ziet de app hem niet.)
3. Deploy opnieuw zonder build-cache.

Laat je dit leeg, dan zegt NOVA gewoon "Goedemorgen, welkom terug" zonder naam.

=====================================================================
OPSTARTGEDRAG VAN NOVA (nieuw)
=====================================================================

Na het inloggen begroet NOVA je nu hardop (geen pop-up meer) en geeft een
korte samenvatting van wat aandacht vraagt. Daarna verschijnen klikbare acties
rond de cirkel en schakelt NOVA terug naar luistermodus, zodat je meteen kunt
antwoorden of een vervolgvraag kunt stellen.

NOVA noemt alleen wat ze echt weet. Mail en agenda worden pas meegenomen zodra
die gekoppeld zijn; tot die tijd zegt ze daar eerlijk over dat de koppeling
nog moet komen, in plaats van verzonnen aantallen te noemen.

Goedgekeurde taken verschijnen in het Historie-overzicht (knop rechtsboven).

=====================================================================
PRODUCTCATALOG & CONTENTKALENDER (nieuw)
=====================================================================

Twee nieuwe knoppen rechtsboven:

MATERIEEL (productcatalogus)
- Voeg hier de apparatuur van JnA Events toe (rookmachines, licht, geluid, enz.).
- NOVA kent dit materieel daarna automatisch en gebruikt het bij aankondigingen
  en content, zonder dat je het elke keer hoeft uit te leggen.

KALENDER (contentkalender)
- Vraag NOVA om content in te plannen ("plan een TikTok-post voor zaterdag 19:30").
- NOVA zet de post in de kalender met een voorgesteld optimaal tijdstip.
- LET OP: het echt POSTEN naar TikTok/Instagram gebeurt pas zodra die koppeling
  actief is. Tot die tijd staat de content klaar met status "gepland".

Beide lijsten worden blijvend bewaard als je Vercel KV hebt gekoppeld
(zie de sectie over de verbeterlijst). Zonder KV blijven ze per serversessie.

=====================================================================
ONBOARDING-CHECKLIST & CONFIG-LAAG (nieuw)
=====================================================================

Twee belangrijke verbeteringen die NOVA zelf had gesignaleerd:

CONFIG-LAAG (api/_config.js)
- Alle environment-variabelen worden nu via één bestand uitgelezen.
- Geen enkel ander bestand leest nog direct process.env. Zo zie je in een
  oogopslag waar alles staat en wat NOVA nodig heeft.
- Geheime waarden staan NOOIT in de code, alleen in Vercel.

ONBOARDING-CHECKLIST (knop "Onboarding" rechtsboven)
- Toont per koppeling of die gezet is (groen vinkje) of mist (rood !).
- Verplicht en optioneel zijn duidelijk gescheiden.
- Elk item heeft uitleg en de exacte naam van de variabele in Vercel.
- Knop "Verversen" om opnieuw te checken na een redeploy.
- Geheime waarden worden NOOIT in de chat ingevoerd, alleen in de
  Environment Variables van Vercel (dat staat ook in het paneel zelf).

WhatsApp en IMAP-mail aansluitpunten zijn voorbereid maar niet actief.
De checklist vertelt je precies welke gegevens je moet aanvragen.

=====================================================================
SETUP-CHECKLIST & GESCHEIDEN CONFIGURATIELAAG (nieuw)
=====================================================================

Twee aanvullingen vanuit NOVA's verbeterlijst:

1. SETUP-KNOP (rechtsboven, naast Kalender)
   Een stap-voor-stap checklist voor elke koppeling: WhatsApp Business, e-mail
   (Gmail/Outlook/IMAP), TikTok Business, en Instagram/Facebook. Vink af wat je
   gedaan hebt, NOVA bewaart de voortgang. Geeft je een duidelijke routekaart
   per integratie in plaats van losse berichten.

2. CONFIGURATIELAAG GESCHEIDEN
   Alle instellingen en opslag-logica staan nu samen in api/_config.js. Open
   dat bestand en je ziet in een oogopslag wat NOVA verwacht, waar gegevens
   bewaard worden, en welke koppelingen klaarstaan voor de toekomst. Wijzigt
   er iets aan opslag, dan pas je het op een plek aan.

VEILIGHEID VAN WACHTWOORDEN (verbeterpunt 5)
NOVA's verbeterpunt over wachtwoorden was al goed geregeld: wachtwoorden worden
NOOIT via de chat ingevoerd. Het wachtwoord op het loginscherm gaat via een
apart, beveiligd veld en wordt serverside gecontroleerd via een token. API-
sleutels staan uitsluitend in Vercel Environment Variables, niet in de code.
De Setup-checklist herhaalt dit principe expliciet zodat je het kunt zien.

WHATSAPP EN IMAP (verbeterpunten 2 en 3)
De aansluitpunten voor WhatsApp Business (Twilio/360dialog) en IMAP/Gmail
staan klaar in de configuratielaag. Zodra jij de accounts hebt aangevraagd
en de tokens in Vercel zet (zie de Setup-checklist voor de stappen), klikt
de echte koppeling er automatisch in.

=====================================================================
WHATSAPP EN IMAP-MAIL AANSLUITPUNTEN (nieuw)
=====================================================================

De code voor WhatsApp en IMAP is nu af. Zodra jij de juiste tokens in Vercel
zet en opnieuw deployt, werkt het echt - geen extra codewijziging nodig.

----- IMAP-MAIL (werkt voor info@jna-events.nl) -----

In Vercel Environment Variables (scope Production):
   IMAP_HOST    bijv. mail.jna-events.nl  (vraag aan je hostingprovider)
   IMAP_PORT    993 (standaard, kan leeg)
   IMAP_USER    info@jna-events.nl
   IMAP_PASS    een APP-WACHTWOORD, NIET je gewone wachtwoord

App-wachtwoord aanmaken:
- Bij Gmail: myaccount.google.com > Beveiliging > App-wachtwoorden
- Bij Outlook: account.microsoft.com > Beveiliging > App-wachtwoorden
- Bij je eigen hosting (jna-events.nl): in je controlepaneel onder
  "E-mail" of "Mailbox-beheer" een app-specifiek wachtwoord aanmaken.

Na deploy haalt NOVA bij elke login de laatste 20 mails op en bepaalt zelf
welke aandacht vragen (op basis van inhoud en afzender).

----- WHATSAPP via TWILIO (aanrader voor Nederland) -----

In Vercel Environment Variables:
   TWILIO_SID    je Account SID (begint met AC)
   TWILIO_TOKEN  je Auth Token
   TWILIO_FROM   "whatsapp:+1415..." (je goedgekeurde WhatsApp-nummer)
   WHATSAPP_WEBHOOK_SECRET   verzin een lange willekeurige tekst

Daarna in Twilio Console > Messaging > WhatsApp Sender:
- Inbound webhook URL:
  https://agent.jna-events.nl/api/whatsapp-webhook?secret=DE_GEHEIME_WAARDE
- Method: HTTP POST

----- WHATSAPP via 360DIALOG (alternatief) -----

In Vercel:
   WHATSAPP_TOKEN          je 360dialog API key
   WHATSAPP_PHONE_ID       je phone number ID
   WHATSAPP_WEBHOOK_SECRET verzin een lange willekeurige tekst

In het 360dialog dashboard > Webhook:
- URL: https://agent.jna-events.nl/api/whatsapp-webhook?secret=DE_GEHEIME_WAARDE

----- WAT NOVA NU KAN -----

Vraag NOVA bijvoorbeeld:
- "Stuur Anna een WhatsApp dat de reservering bevestigd is, nummer +316..."
  Dan toont ze een goedkeur-overlay; pas na jouw klik op "Versturen" gaat
  het bericht echt naar de provider.
- Bij login meldt NOVA hoeveel nieuwe mails er zijn (echt opgehaald via IMAP)
  en hoeveel nieuwe WhatsApp-berichten via de webhook zijn binnengekomen.

----- BEPERKING (eerlijk) -----

NOVA haalt mail op bij login en bij handmatige checks. Echt LIVE binnenkomende
mail die meteen verwerkt wordt vereist een achtergrondproces dat constant draait,
en dat past niet in serverless. Voor 95% van de gebruikssituaties is ophalen
bij login even praktisch.

=====================================================================
MULTI-AGENT CONTENT WORKFLOW + AI-BEELDGENERATIE (nieuw)
=====================================================================

Vraag NOVA om content (bijv. "maak TikTok-content voor de nieuwe rookmachine")
en er starten vier gespecialiseerde agents tegelijk:

   Marketing Director - bepaalt hoek, doelgroep en gewenste actie
   Content Creator     - schrijft hook, caption en hashtags
   Visual Director     - bedenkt drie visual-concepten met prompts
   Video Director      - levert shotlist en regie-script voor video

Resultaat verschijnt als post-paneel met alle vier de blokken. De drie
visual-concepten zijn klikbaar: klik om er echt een AI-beeld van te
genereren via OpenAI's gpt-image-1.

Goedkeur de post en hij gaat automatisch in de Contentkalender.

----- AI-BEELDGENERATIE INSTELLEN -----

In Vercel Environment Variables:
   OPENAI_API_KEY     je sleutel van platform.openai.com (begint met sk-)

Maak een sleutel op platform.openai.com > API keys > Create new secret key.
Zet daar OOK een credit-limiet om verrassingen te voorkomen
(Settings > Billing > Usage limits).

KOSTEN per beeld (november 2025, kan veranderen):
   Low quality:    ~$0,02 per beeld
   Medium quality: ~$0,07 per beeld (standaard in deze app)
   High quality:   ~$0,19 per beeld

Beelden worden ALLEEN gegenereerd als je in het post-paneel op een
visual-tegel klikt. Nooit automatisch. Vooraf zie je de geschatte prijs.

----- WAT JE NU ECHT KRIJGT -----

Voorbeeld: "Maak TikTok-content voor de nieuwe rookmachine"
- Strategische hoek + doelgroep (door Marketing Director)
- Hook + caption + hashtags (door Content Creator)
- 3 verticale 1024x1536 visual-concepten klaar voor generatie
- Compleet shotlist + voice-over tekst (door Video Director)

VIDEO blijft (eerlijk) handwerk: NOVA levert het regie-script + shotlist
zodat jij of een videobewerker dit met je telefoon kunt opnemen. Echte
AI-videogeneratie is nog niet professioneel genoeg voor productvideo's.

----- ZONDER OPENAI_API_KEY -----

Werkt alles behalve het genereren van de beelden zelf. De drie visual-
concepten met prompts zijn er wel, je kunt ze gebruiken in andere tools
(Midjourney, Stable Diffusion, of zelfs als briefing voor een fotograaf).

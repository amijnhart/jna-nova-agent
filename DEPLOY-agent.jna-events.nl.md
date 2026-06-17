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

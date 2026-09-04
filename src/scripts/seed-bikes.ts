import "dotenv/config";
import prisma from '../lib/prisma.js';

// Note: Wikimedia now restricts direct/hotlinked thumbnail requests to a
// fixed set of "standard" widths (20/40/60/120/250/330/500/960/1280/1920/3840px)
// and rejects arbitrary widths like the previous 512px with a 400. All
// logoUrl values below use 500px (verified resolvable) and have been
// double-checked against the real current Commons file path/hash for each
// manufacturer (a few of the original entries pointed at stale/incorrect
// hashes that predate a Commons file rename).
//
// 2026-09 addition (global/premium + India-market + EV manufacturers):
// every new logoUrl below was resolved via Commons' Special:FilePath
// redirect (which always finds the current hash path regardless of file
// renames) and re-verified with a direct HTTP HEAD/GET for a 200 + image
// content-type immediately before being added here.
//
// Skipped entirely (no free/verifiable brand logo found on Commons as of
// this seeding — every candidate file checked turned out to belong to an
// unrelated same-named entity): Benelli (only "Benelli Armi" firearms
// logos exist on Commons, not the Q.J.-owned motorcycle brand), Norton
// (Commons' "Norton" logo files are all NortonLifeLock/Gen Digital
// antivirus branding; the real Norton Motorcycle Company logo is only
// hosted as a non-free fair-use file on en.wikipedia, not Commons), Jawa
// (no dedicated Jawa wordmark/logo file found on Commons under any
// searched name), and Revolt Motors (the two "Revolt ..." logo files on
// Commons are Revolt Chat and an unidentified/unrelated "REVOLT" logo,
// not Revolt Motors).
//
// EV sub-brand judgment calls: Bajaj's "Chetak" EV scooter brand got its
// own manufacturer row below (distinct real Commons logo found, and it's
// retailed through separate "Chetak" showrooms from Bajaj Auto). Hero
// MotoCorp's "Vida" EV brand did NOT get its own row — no free/verifiable
// Vida logo exists on Commons (the only "Vida" logo files found there
// belong to an unrelated Austrian trade union) — so its real models
// (Vida V1 Pro, Vida VX2) are listed under Hero MotoCorp instead.
const manufacturers = [
  {
    name: 'Yamaha',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Yamaha_Motor_logo.svg/500px-Yamaha_Motor_logo.svg.png',
    description: 'Yamaha Motor Company Limited is a Japanese manufacturer of motorcycles, marine products such as boats and outboard motors, and other motorized products.',
    originCountry: 'Japan',
    foundedYear: 1955,
    models: [
      { name: 'YZF-R1', category: 'SPORT', engineCc: 998, startYear: 1998, imageUrl: 'https://images.unsplash.com/photo-1558981359-219d6364c9c8?auto=format&fit=crop&q=80&w=1000' },
      { name: 'YZF-R15 V4', category: 'SPORT', engineCc: 155, startYear: 2021, imageUrl: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&q=80&w=1000' },
      { name: 'MT-09', category: 'NAKED', engineCc: 890, startYear: 2014, imageUrl: 'https://images.unsplash.com/photo-1621252179027-9d7a22a275f1?auto=format&fit=crop&q=80&w=1000' },
      { name: 'Tenere 700', category: 'ADVENTURE', engineCc: 689, startYear: 2019, imageUrl: 'https://images.unsplash.com/photo-1610014286121-6d9b54ce7990?auto=format&fit=crop&q=80&w=1000' }
    ]
  },
  {
    name: 'Honda',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Honda_Logo.svg/500px-Honda_Logo.svg.png',
    description: 'Honda Motor Co., Ltd. is a Japanese public multinational conglomerate manufacturer of automobiles, motorcycles, and power equipment.',
    originCountry: 'Japan',
    foundedYear: 1948,
    models: [
      { name: 'CBR1000RR-R Fireblade', category: 'SPORT', engineCc: 999, startYear: 2020, imageUrl: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&q=80&w=1000' },
      { name: 'CRF1100L Africa Twin', category: 'ADVENTURE', engineCc: 1084, startYear: 2020, imageUrl: 'https://images.unsplash.com/photo-1558981359-219d6364c9c8?auto=format&fit=crop&q=80&w=1000' },
      { name: 'CB650R', category: 'NAKED', engineCc: 649, startYear: 2019, imageUrl: 'https://images.unsplash.com/photo-1610014286121-6d9b54ce7990?auto=format&fit=crop&q=80&w=1000' }
    ]
  },
  {
    name: 'KTM',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/KTM-Logo.svg/500px-KTM-Logo.svg.png',
    description: 'KTM AG is an Austrian motorcycle, bicycle and sports car manufacturer owned by Pierer Mobility AG and Indian manufacturer Bajaj Auto.',
    originCountry: 'Austria',
    foundedYear: 1992,
    models: [
      { name: 'Duke 390', category: 'NAKED', engineCc: 373, startYear: 2013, imageUrl: 'https://images.unsplash.com/photo-1621252179027-9d7a22a275f1?auto=format&fit=crop&q=80&w=1000' },
      { name: 'RC 390', category: 'SPORT', engineCc: 373, startYear: 2014, imageUrl: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&q=80&w=1000' },
      { name: '1290 Super Adventure R', category: 'ADVENTURE', engineCc: 1301, startYear: 2015, imageUrl: 'https://images.unsplash.com/photo-1558981359-219d6364c9c8?auto=format&fit=crop&q=80&w=1000' }
    ]
  },
  {
    name: 'Ducati',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Ducati_red_logo.svg/500px-Ducati_red_logo.svg.png',
    description: 'Ducati Motor Holding S.p.A. is the motorcycle-manufacturing division of Italian company Ducati, headquartered in Bologna, Italy.',
    originCountry: 'Italy',
    foundedYear: 1926,
    models: [
      { name: 'Panigale V4', category: 'SPORT', engineCc: 1103, startYear: 2018, imageUrl: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&q=80&w=1000' },
      { name: 'Monster', category: 'NAKED', engineCc: 937, startYear: 1993, imageUrl: 'https://images.unsplash.com/photo-1621252179027-9d7a22a275f1?auto=format&fit=crop&q=80&w=1000' },
      { name: 'Multistrada V4', category: 'ADVENTURE', engineCc: 1158, startYear: 2021, imageUrl: 'https://images.unsplash.com/photo-1610014286121-6d9b54ce7990?auto=format&fit=crop&q=80&w=1000' }
    ]
  },
  {
    name: 'Royal Enfield',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Royal_Enfield_logo.svg/500px-Royal_Enfield_logo.svg.png',
    description: 'Royal Enfield is an Indian multinational motorcycle manufacturing company headquartered in Chennai, Tamil Nadu, India.',
    originCountry: 'India',
    foundedYear: 1955,
    models: [
      { name: 'Classic 350', category: 'CRUISER', engineCc: 349, startYear: 2009, imageUrl: 'https://images.unsplash.com/photo-1610014286121-6d9b54ce7990?auto=format&fit=crop&q=80&w=1000' },
      { name: 'Meteor 350', category: 'CRUISER', engineCc: 349, startYear: 2020, imageUrl: 'https://images.unsplash.com/photo-1558981359-219d6364c9c8?auto=format&fit=crop&q=80&w=1000' },
      { name: 'Himalayan', category: 'ADVENTURE', engineCc: 411, startYear: 2016, imageUrl: 'https://images.unsplash.com/photo-1621252179027-9d7a22a275f1?auto=format&fit=crop&q=80&w=1000' },
      { name: 'Continental GT 650', category: 'CAFE_RACER', engineCc: 648, startYear: 2018, imageUrl: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&q=80&w=1000' }
    ]
  },
  {
    name: 'Kawasaki',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Kawasaki-logo.svg/500px-Kawasaki-logo.svg.png',
    description: 'Kawasaki Motorcycles is a division of Kawasaki Heavy Industries, renowned for their Ninja sport bikes and Z series naked bikes.',
    originCountry: 'Japan',
    foundedYear: 1896,
    models: [
      { name: 'Ninja ZX-10R', category: 'SPORT', engineCc: 998, startYear: 2004, imageUrl: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&q=80&w=1000' },
      { name: 'Z900', category: 'NAKED', engineCc: 948, startYear: 2017, imageUrl: 'https://images.unsplash.com/photo-1621252179027-9d7a22a275f1?auto=format&fit=crop&q=80&w=1000' },
      { name: 'Versys 650', category: 'ADVENTURE', engineCc: 649, startYear: 2007, imageUrl: 'https://images.unsplash.com/photo-1610014286121-6d9b54ce7990?auto=format&fit=crop&q=80&w=1000' }
    ]
  },
  {
    name: 'BMW Motorrad',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/BMW.svg/500px-BMW.svg.png',
    description: 'BMW Motorrad is the motorcycle brand of the German company BMW, known for their GS adventure series and premium motorcycles.',
    originCountry: 'Germany',
    foundedYear: 1923,
    models: [
      { name: 'S 1000 RR', category: 'SPORT', engineCc: 999, startYear: 2009, imageUrl: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&q=80&w=1000' },
      { name: 'R 1250 GS', category: 'ADVENTURE', engineCc: 1254, startYear: 2019, imageUrl: 'https://images.unsplash.com/photo-1558981359-219d6364c9c8?auto=format&fit=crop&q=80&w=1000' },
      { name: 'M 1000 R', category: 'NAKED', engineCc: 999, startYear: 2023, imageUrl: 'https://images.unsplash.com/photo-1621252179027-9d7a22a275f1?auto=format&fit=crop&q=80&w=1000' }
    ]
  },
  {
    name: 'TVS',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/TVS_logo_%282024%29.png/500px-TVS_logo_%282024%29.png',
    description: 'TVS Motor Company is an Indian multinational motorcycle manufacturer headquartered in Chennai.',
    originCountry: 'India',
    foundedYear: 1978,
    models: [
      { name: 'Apache RR 310', category: 'SPORT', engineCc: 312, startYear: 2017, imageUrl: 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&q=80&w=1000' },
      { name: 'Apache RTR 200 4V', category: 'NAKED', engineCc: 197, startYear: 2016, imageUrl: 'https://images.unsplash.com/photo-1621252179027-9d7a22a275f1?auto=format&fit=crop&q=80&w=1000' }
    ]
  },
  {
    name: 'Suzuki',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Suzuki_Motor_Corporation_logo.svg/500px-Suzuki_Motor_Corporation_logo.svg.png',
    description: 'Suzuki Motor Corporation is a Japanese multinational manufacturer of motorcycles, automobiles, and marine engines headquartered in Hamamatsu.',
    originCountry: 'Japan',
    foundedYear: 1909,
    // No imageUrl on these models — the mobile app now sources model
    // photos live from Wikimedia Commons search instead of trusting this field.
    models: [
      { name: 'Hayabusa', category: 'SPORT', engineCc: 1340, startYear: 1999 },
      { name: 'V-Strom 650', category: 'ADVENTURE', engineCc: 645, startYear: 2004 },
      { name: 'Gixxer SF', category: 'SPORT', engineCc: 155, startYear: 2015 }
    ]
  },
  {
    name: 'Triumph',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Triumph_Motorcycles_logo_and_claim_2015.svg/500px-Triumph_Motorcycles_logo_and_claim_2015.svg.png',
    description: 'Triumph Motorcycles Ltd is a British motorcycle manufacturer headquartered in Hinckley, Leicestershire, England.',
    originCountry: 'United Kingdom',
    foundedYear: 1902,
    models: [
      { name: 'Street Triple', category: 'NAKED', engineCc: 765, startYear: 2007 },
      { name: 'Tiger 900', category: 'ADVENTURE', engineCc: 888, startYear: 2020 },
      { name: 'Speed 400', category: 'NAKED', engineCc: 398, startYear: 2023 }
    ]
  },
  {
    name: 'Harley-Davidson',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Harley-Davidson_logo.svg/500px-Harley-Davidson_logo.svg.png',
    description: 'Harley-Davidson, Inc. is an American motorcycle manufacturer headquartered in Milwaukee, Wisconsin, renowned for its cruiser and touring motorcycles.',
    originCountry: 'United States',
    foundedYear: 1903,
    models: [
      { name: 'Iron 883', category: 'CRUISER', engineCc: 883, startYear: 2009 },
      { name: 'X440', category: 'CRUISER', engineCc: 440, startYear: 2023 },
      { name: 'Street Glide', category: 'TOURING', engineCc: 1868, startYear: 2006 }
    ]
  },
  {
    name: 'Aprilia',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Aprilia-logo.svg/500px-Aprilia-logo.svg.png',
    description: 'Aprilia is an Italian motor vehicle manufacturer, part of the Piaggio Group, headquartered in Noale, Italy, renowned for its high-performance sport motorcycles and MotoGP racing heritage.',
    originCountry: 'Italy',
    foundedYear: 1945,
    models: [
      { name: 'RS 660', category: 'SPORT', engineCc: 659, startYear: 2020 },
      { name: 'Tuono 660', category: 'NAKED', engineCc: 659, startYear: 2021 },
      { name: 'RSV4', category: 'SUPERBIKE', engineCc: 1077, startYear: 2009 },
      { name: 'SR 160', category: 'SCOOTER', engineCc: 160, startYear: 2021 }
    ]
  },
  {
    name: 'Indian Motorcycle',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Indian_Motorcycle_logo.svg/500px-Indian_Motorcycle_logo.svg.png',
    description: 'Indian Motorcycle Company is an American motorcycle manufacturer headquartered in Medina, Minnesota, and owned by Polaris Inc., recognized as America\'s first motorcycle brand.',
    originCountry: 'United States',
    foundedYear: 1901,
    models: [
      { name: 'Scout', category: 'CRUISER', engineCc: 1133, startYear: 2015 },
      { name: 'Chief', category: 'CRUISER', engineCc: 1890, startYear: 2022 },
      { name: 'Chieftain', category: 'TOURING', engineCc: 1890, startYear: 2014 },
      { name: 'FTR 1200', category: 'NAKED', engineCc: 1203, startYear: 2019 }
    ]
  },
  {
    name: 'Husqvarna',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Husqvarna_logo.svg/500px-Husqvarna_logo.svg.png',
    description: 'Husqvarna Motorcycles GmbH is a motorcycle manufacturer with Swedish roots dating to 1903, now headquartered in Mattighofen, Austria under Pierer Mobility, known for its Svartpilen/Vitpilen street bikes and enduro machines.',
    originCountry: 'Sweden',
    foundedYear: 1903,
    models: [
      { name: 'Svartpilen 401', category: 'NAKED', engineCc: 373, startYear: 2018 },
      { name: 'Vitpilen 401', category: 'CAFE_RACER', engineCc: 373, startYear: 2018 },
      { name: 'Norden 901', category: 'ADVENTURE', engineCc: 889, startYear: 2022 }
    ]
  },
  {
    name: 'Vespa',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Vespa-logo.svg/500px-Vespa-logo.svg.png',
    description: 'Vespa is an Italian scooter brand manufactured by Piaggio, headquartered in Pontedera, Italy, celebrated worldwide as an icon of Italian design since its debut in 1946.',
    originCountry: 'Italy',
    foundedYear: 1946,
    models: [
      { name: 'Primavera 150', category: 'SCOOTER', engineCc: 155, startYear: 2014 },
      { name: 'GTS 300', category: 'SCOOTER', engineCc: 278, startYear: 2008 },
      { name: 'Sprint 150', category: 'SCOOTER', engineCc: 155, startYear: 2014 }
    ]
  },
  {
    name: 'BSA',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/2021_BSA_Logo.jpg/500px-2021_BSA_Logo.jpg',
    description: 'BSA (Birmingham Small Arms) is a historic British motorcycle marque with roots dating to 1861, revived under Classic Legends (Mahindra Group) and headquartered in Birmingham, UK.',
    originCountry: 'United Kingdom',
    foundedYear: 1861,
    models: [
      { name: 'Gold Star', category: 'SPORT', engineCc: 499, startYear: 1938, endYear: 1963 },
      { name: 'Bantam', category: 'COMMUTER', engineCc: 123, startYear: 1948, endYear: 1971 },
      { name: 'Gold Star 650', category: 'NAKED', engineCc: 652, startYear: 2023 }
    ]
  },
  {
    name: 'Moto Guzzi',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Moto_Guzzi_Symbol.png/500px-Moto_Guzzi_Symbol.png',
    description: 'Moto Guzzi is an Italian motorcycle manufacturer based in Mandello del Lario, Italy, the oldest European motorcycle brand in continuous production, now owned by the Piaggio Group.',
    originCountry: 'Italy',
    foundedYear: 1921,
    models: [
      { name: 'V7', category: 'NAKED', engineCc: 853, startYear: 2021 },
      { name: 'V85 TT', category: 'ADVENTURE', engineCc: 853, startYear: 2019 },
      { name: 'California 1400', category: 'TOURING', engineCc: 1380, startYear: 2013 }
    ]
  },
  {
    name: 'Bajaj Auto',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Bajaj_Auto_Ltd_logo.svg/500px-Bajaj_Auto_Ltd_logo.svg.png',
    description: 'Bajaj Auto Limited is an Indian multinational two-wheeler and three-wheeler manufacturer headquartered in Pune, Maharashtra, one of India\'s largest motorcycle makers and a major stakeholder in KTM\'s parent company Pierer Mobility.',
    originCountry: 'India',
    foundedYear: 1945,
    models: [
      { name: 'Pulsar NS200', category: 'NAKED', engineCc: 199, startYear: 2012 },
      { name: 'Dominar 400', category: 'TOURING', engineCc: 373, startYear: 2017 },
      { name: 'Avenger Cruise 220', category: 'CRUISER', engineCc: 220, startYear: 2017 },
      { name: 'Platina 100', category: 'COMMUTER', engineCc: 102, startYear: 2006 }
    ]
  },
  {
    name: 'Hero MotoCorp',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Hero_MotoCorp_Logo.svg/500px-Hero_MotoCorp_Logo.svg.png',
    description: 'Hero MotoCorp Ltd is an Indian multinational motorcycle and scooter manufacturer headquartered in New Delhi, the world\'s largest two-wheeler manufacturer by volume, formed after splitting from Hero Honda in 2010. Its electric sub-brand Vida is represented here as models rather than a separate row (see script header note).',
    originCountry: 'India',
    foundedYear: 1984,
    models: [
      { name: 'Splendor Plus', category: 'COMMUTER', engineCc: 97, startYear: 1994 },
      { name: 'Xtreme 160R', category: 'NAKED', engineCc: 163, startYear: 2020 },
      { name: 'Vida V1 Pro', category: 'SCOOTER', startYear: 2022 },
      { name: 'Vida VX2', category: 'SCOOTER', startYear: 2024 }
    ]
  },
  {
    name: 'Yezdi',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Yezdi_Logo.png/500px-Yezdi_Logo.png',
    description: 'Yezdi is an Indian motorcycle brand revived by Classic Legends (Mahindra Group) in 2022, tracing its heritage to Ideal Jawa Mysore\'s original Yezdi motorcycles produced from the 1960s to 1996.',
    originCountry: 'India',
    foundedYear: 2022,
    models: [
      { name: 'Roadster', category: 'NAKED', engineCc: 334, startYear: 2022 },
      { name: 'Scrambler', category: 'DUAL_SPORT', engineCc: 334, startYear: 2022 },
      { name: 'Adventure', category: 'ADVENTURE', engineCc: 334, startYear: 2022 }
    ]
  },
  {
    name: 'Ather Energy',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Ather-logo.svg/500px-Ather-logo.svg.png',
    description: 'Ather Energy is an Indian electric vehicle company headquartered in Bengaluru, founded by Tarun Mehta and Swapnil Jain, known for its 450-series smart electric scooters and proprietary fast-charging network.',
    originCountry: 'India',
    foundedYear: 2013,
    // Electric models: engineCc intentionally omitted (not applicable to EVs).
    // BikeModel has no electric-specific spec field (e.g. battery/motor power),
    // so no substitute field is invented here.
    models: [
      { name: '450X', category: 'SCOOTER', startYear: 2018 },
      { name: '450S', category: 'SCOOTER', startYear: 2023 },
      { name: 'Rizta', category: 'SCOOTER', startYear: 2024 }
    ]
  },
  {
    name: 'Ola Electric',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/OLA_Electric_logo.svg/500px-OLA_Electric_logo.svg.png',
    description: 'Ola Electric Mobility Ltd is an Indian electric vehicle manufacturer headquartered in Bengaluru, founded by Bhavish Aggarwal, operating one of the world\'s largest scooter manufacturing facilities in Tamil Nadu.',
    originCountry: 'India',
    foundedYear: 2017,
    models: [
      { name: 'S1 Pro', category: 'SCOOTER', startYear: 2021 },
      { name: 'S1 Air', category: 'SCOOTER', startYear: 2022 },
      { name: 'Roadster', category: 'NAKED', startYear: 2024 }
    ]
  },
  {
    name: 'Ultraviolette',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Ultraviolette_logo.jpg/500px-Ultraviolette_logo.jpg',
    description: 'Ultraviolette Automotive is an Indian electric motorcycle manufacturer headquartered in Bengaluru, founded by Narayan Subramaniam and Niraj Rajmohan, known for the high-performance F77 electric motorcycle.',
    originCountry: 'India',
    foundedYear: 2016,
    models: [
      { name: 'F77', category: 'SPORT', startYear: 2022 },
      { name: 'Tesseract', category: 'SCOOTER', startYear: 2024 }
    ]
  },
  {
    // Judgment call (per task instructions): Chetak is modeled as its own
    // manufacturer row rather than as models under "Bajaj Auto" above,
    // because Bajaj markets/retails it as a distinct EV brand with its own
    // dedicated "Chetak" showrooms and a real, verifiable Commons logo
    // distinct from the Bajaj Auto corporate logo. Hero's "Vida" EV
    // sub-brand did NOT get the same treatment (see Hero MotoCorp above)
    // because no verifiable free logo for Vida could be found.
    name: 'Bajaj Chetak',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Bajaj_Chetak_logo.jpg/500px-Bajaj_Chetak_logo.jpg',
    description: 'Chetak is Bajaj Auto\'s all-electric scooter brand, manufactured at Bajaj\'s Akurdi plant in Pune and sold through dedicated Chetak showrooms, launched in 2020 as a modern electric reinterpretation of Bajaj\'s iconic Chetak nameplate.',
    originCountry: 'India',
    foundedYear: 2020,
    models: [
      { name: 'Chetak Premium', category: 'SCOOTER', startYear: 2020 },
      { name: 'Chetak Urbane', category: 'SCOOTER', startYear: 2022 }
    ]
  }
];

async function main() {
  console.log('Seeding manufacturers and models...');
  
  for (const mData of manufacturers) {
    const { models, ...mDetails } = mData;
    
    // Upsert Manufacturer
    const manufacturer = await prisma.manufacturer.upsert({
      where: { name: mDetails.name },
      update: mDetails,
      create: mDetails,
    });
    
    console.log(`Upserted manufacturer: ${manufacturer.name}`);
    
    // Upsert Models
    for (const modelData of models) {
      const existing = await prisma.bikeModel.findFirst({
        where: {
          manufacturerId: manufacturer.id,
          name: modelData.name
        }
      });
      
      if (existing) {
        await prisma.bikeModel.update({
          where: { id: existing.id },
          data: modelData
        });
      } else {
        await prisma.bikeModel.create({
          data: {
            ...modelData,
            manufacturerId: manufacturer.id
          }
        });
      }
    }
  }
  
  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

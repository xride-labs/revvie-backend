import "dotenv/config";
import prisma from '../lib/prisma.js';

// Note: Wikimedia now restricts direct/hotlinked thumbnail requests to a
// fixed set of "standard" widths (20/40/60/120/250/330/500/960/1280/1920/3840px)
// and rejects arbitrary widths like the previous 512px with a 400. All
// logoUrl values below use 500px (verified resolvable) and have been
// double-checked against the real current Commons file path/hash for each
// manufacturer (a few of the original entries pointed at stale/incorrect
// hashes that predate a Commons file rename).
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

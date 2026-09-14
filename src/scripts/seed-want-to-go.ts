import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";

const PROD_DATABASE_URL =
  "postgresql://postgres.uvidmcblrxscmihsasgm:8xNBndAES%40revvie@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres";

const adapter = new PrismaPg({
  connectionString: PROD_DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const USER_ID = "cmr0f6pax0001qkd2466anhot";
const filePath =
  "C:/Users/krith/.gemini/antigravity-ide/brain/c5822ef6-44aa-4430-a1f5-593288faf9f0/scratch/want_to_go_cleaned.json";
const places = JSON.parse(fs.readFileSync(filePath, "utf8"));

async function seed() {
  try {
    console.log(`--- Step 1: Creating or Finding "Want to go" List for ${USER_ID} ---`);
    let list = await prisma.savedPlaceList.findFirst({
      where: {
        userId: USER_ID,
        title: "Want to go",
      },
    });

    if (!list) {
      list = await prisma.savedPlaceList.create({
        data: {
          userId: USER_ID,
          title: "Want to go",
          description: "Saved places from Google Maps",
          icon: "bookmark",
          color: "#F59E0B",
          isPublic: true,
        },
      });
      console.log("Created new SavedPlaceList:", list.id, list.title);
    } else {
      console.log("Found existing SavedPlaceList:", list.id, list.title);
    }

    console.log("\n--- Step 2: Checking for Existing Places in List ---");
    const existingInList = await prisma.savedLocation.findMany({
      where: {
        userId: USER_ID,
        listId: list.id,
      },
      select: { name: true, latitude: true, longitude: true },
    });
    console.log(`Currently ${existingInList.length} places in this list.`);

    const existingSignatures = new Set(
      existingInList.map(
        (p) => `${p.name.toLowerCase()}|${p.latitude.toFixed(4)}|${p.longitude.toFixed(4)}`,
      ),
    );

    const placesToInsert: any[] = [];
    for (const p of places) {
      const sig = `${p.name.toLowerCase()}|${p.latitude.toFixed(4)}|${p.longitude.toFixed(4)}`;
      if (!existingSignatures.has(sig)) {
        placesToInsert.push({
          userId: USER_ID,
          listId: list.id,
          name: p.name,
          address: p.address,
          latitude: p.latitude,
          longitude: p.longitude,
          type: "FAVORITE",
          icon: "bookmark",
        });
        existingSignatures.add(sig);
      }
    }

    console.log(`New places to insert: ${placesToInsert.length} (out of ${places.length} total)`);

    if (placesToInsert.length > 0) {
      const BATCH_SIZE = 100;
      for (let i = 0; i < placesToInsert.length; i += BATCH_SIZE) {
        const batch = placesToInsert.slice(i, i + BATCH_SIZE);
        await prisma.savedLocation.createMany({
          data: batch,
        });
        console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} places)...`);
      }
      console.log("✓ All places successfully seeded into Supabase prod database!");
    }

    const totalInList = await prisma.savedLocation.count({
      where: { listId: list.id },
    });
    console.log(`Total places now in "Want to go" list: ${totalInList}`);

    const userLists = await prisma.savedPlaceList.findMany({
      where: { userId: USER_ID },
      include: {
        _count: {
          select: { locations: true },
        },
      },
    });

    console.log("\n--- User Lists Summary ---");
    userLists.forEach((l) => {
      console.log(`• List: "${l.title}" (ID: ${l.id}) - ${l._count.locations} places`);
    });
  } catch (err) {
    console.error("Error during seeding:", err);
  } finally {
    await prisma.$disconnect();
  }
}

seed();

const bcrypt = require('bcryptjs');
const sheetsService = require('../services/sheetsService');

async function run() {
  console.log("Seeding users based on active database locations...");
  try {
    // Fetch unique locations from active and completed apprentice sheets
    const activeRaw = await sheetsService.getActiveApprentices();
    const completedRaw = await sheetsService.getCompletedApprentices();

    const locationSet = new Set();
    activeRaw.forEach(row => {
      const loc = String(row['Location'] || '').trim();
      if (loc) locationSet.add(loc);
    });
    completedRaw.forEach(row => {
      const loc = String(row['Location'] || '').trim();
      if (loc) locationSet.add(loc);
    });

    const locations = Array.from(locationSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const initialUsers = [
      { 
        UserID: 1, 
        Name: 'Super Admin HR', 
        Email: 'super.hr@pgpglass.com', 
        Password: 'PGP@2024', 
        Role: 'Super HR', 
        Location: 'All Locations', 
        Status: 'Active' 
      }
    ];

    let userIdCounter = 2;
    locations.forEach(loc => {
      // Create a clean email slug from location name (e.g. "Kosamba-Main Plant" -> "kosamba-main.plant.hr@pgpglass.com")
      const slug = loc.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // remove special characters except spaces and dashes
        .trim()
        .replace(/\s+/g, '.'); // replace spaces with dots
      
      initialUsers.push({
        UserID: userIdCounter++,
        Name: `${loc} HR Lead`,
        Email: `${slug}.hr@pgpglass.com`,
        Password: 'PGP@2024',
        Role: 'Branch HR',
        Location: loc,
        Status: 'Active'
      });
    });

    const seededUsers = [];
    for (const u of initialUsers) {
      const hash = await bcrypt.hash(u.Password, 10);
      seededUsers.push({
        UserID: u.UserID,
        Name: u.Name,
        Email: u.Email,
        PasswordHash: hash,
        Role: u.Role,
        Location: u.Location,
        Status: u.Status,
        CreatedDate: new Date().toISOString().split('T')[0]
      });
    }

    await sheetsService.saveUsers(seededUsers);
    console.log("Successfully seeded users into Google Sheet!");
    console.log("Seeded Users:");
    initialUsers.forEach(u => console.log(`  - ${u.Name} (${u.Email}) -> Location: ${u.Location}`));
  } catch (err) {
    console.error("Error seeding users:", err.message);
    console.log("Please check that backend/config/service-account.json is configured correctly.");
  }
}

run();

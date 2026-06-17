const bcrypt = require('bcryptjs');
const sheetsService = require('../services/sheetsService');

const initialUsers = [
  { UserID: 1, Name: 'Super Admin HR', Email: 'super.hr@pgpglass.com', Password: 'PGP@2024', Role: 'Super HR', Location: 'All Locations', Status: 'Active' },
  { UserID: 2, Name: 'Kosamba HR Lead', Email: 'kosamba.hr@pgpglass.com', Password: 'PGP@2024', Role: 'Branch HR', Location: 'Kosamba', Status: 'Active' },
  { UserID: 3, Name: 'Halol HR Officer', Email: 'halol.hr@pgpglass.com', Password: 'PGP@2024', Role: 'Branch HR', Location: 'Halol', Status: 'Active' },
  { UserID: 4, Name: 'Jambusar Admin', Email: 'jambusar.hr@pgpglass.com', Password: 'PGP@2024', Role: 'Branch HR', Location: 'Jambusar', Status: 'Active' }
];

async function run() {
  console.log("Seeding users...");
  try {
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
  } catch (err) {
    console.error("Error seeding users:", err.message);
    console.log("Please check that backend/config/service-account.json is configured correctly.");
  }
}

run();

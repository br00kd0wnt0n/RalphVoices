import { pool, query } from './index.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

async function seed() {
  console.log('Seeding database...');

  try {
    // Create a demo user
    const passwordHash = await bcrypt.hash('demo123', 10);
    const userResult = await query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = $3
       RETURNING id`,
      ['demo@ralph.world', passwordHash, 'Demo User']
    );
    const userId = userResult.rows[0].id;
    console.log('Created demo user:', userId);

    // Create a demo project
    const projectResult = await query(
      `INSERT INTO projects (name, client_name, created_by)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['Care Bears', 'Acme Corp', userId]
    );
    const projectId = projectResult.rows[0].id;
    console.log('Created demo project:', projectId);

    // Create a sample persona
    const personaResult = await query(
      `INSERT INTO personas (
        project_id, name, age_base, location, occupation, household,
        psychographics, media_habits, brand_context, cultural_context,
        voice_sample, source_type, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [
        projectId,
        'Urban Millennial Professional',
        28,
        'Brooklyn, NY',
        'UX Designer',
        'Lives with partner, no kids',
        JSON.stringify({
          values: ['authenticity', 'sustainability', 'work-life balance'],
          motivations: ['career growth', 'creative expression', 'experiences over things'],
          aspirations: ['start own design studio', 'travel more', 'make an impact'],
          pain_points: ['information overload', 'expensive rent', 'burnout'],
          decision_style: 'researches thoroughly, values peer recommendations'
        }),
        JSON.stringify({
          primary_platforms: [
            { name: 'Instagram', hours_per_day: 2 },
            { name: 'TikTok', hours_per_day: 1.5 },
            { name: 'LinkedIn', hours_per_day: 0.5 }
          ],
          content_preferences: ['design inspiration', 'career advice', 'travel', 'food'],
          influencer_affinities: ['design thought leaders', 'sustainability advocates'],
          news_sources: ['Twitter/X', 'newsletters', 'podcasts']
        }),
        JSON.stringify({
          category_engagement: 'high',
          brand_awareness: 'aware but selective',
          purchase_drivers: ['quality', 'aesthetics', 'brand values'],
          competitor_preferences: ['Apple', 'Patagonia', 'Glossier']
        }),
        JSON.stringify({
          subcultures: ['design community', 'coffee culture', 'indie music'],
          trending_interests: ['AI tools', 'remote work', 'plant-based food'],
          humor_style: 'dry, appreciates absurdist memes',
          language_markers: ['uses "lowkey"', 'references niche memes', 'avoids corporate speak']
        }),
        `Honestly, I feel like most brands just don't get it? Like, I can tell when something is trying too hard to be relatable. The ads that actually catch my attention are the ones that feel like they were made by someone who actually uses the product, you know? I'm lowkey obsessed with finding brands that have good design AND good values - it's rare but when you find it, chef's kiss. My feed is mostly design inspo and my friends' stories, and if an ad interrupts that flow with something generic, I'm scrolling past immediately.`,
        'builder',
        userId
      ]
    );
    console.log('Created sample persona:', personaResult.rows[0].id);

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();

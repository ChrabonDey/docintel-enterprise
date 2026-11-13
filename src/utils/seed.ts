import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from '../config/database';
import { env } from '../config/env.config';
import { UserModel } from '../modules/auth/auth.model';
import { DocumentService } from '../modules/documents/document.service';
import { JobQueue } from '../modules/jobs/queue.service';
import { VerificationService } from '../modules/validation/verification.service';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  console.log('🌱 Starting database seeding...');
  const db = getDatabase();

  // 1. Seed users
  const adminHash = await bcrypt.hash('AdminPass123!', 10);
  const analystHash = await bcrypt.hash('AnalystPass123!', 10);

  if (!UserModel.findByEmail('admin@docintel.com')) {
    UserModel.create({
      id: uuidv4(),
      username: 'admin',
      email: 'admin@docintel.com',
      password_hash: adminHash,
      role: 'ADMIN',
      api_key: 'doc_key_admin_super_secret_master_token_2026',
    });
    console.log('✅ Seeded admin: admin@docintel.com (AdminPass123!)');
  }

  if (!UserModel.findByEmail('analyst@docintel.com')) {
    UserModel.create({
      id: uuidv4(),
      username: 'analyst',
      email: 'analyst@docintel.com',
      password_hash: analystHash,
      role: 'ANALYST',
      api_key: 'doc_key_analyst_review_token_2026',
    });
    console.log('✅ Seeded analyst: analyst@docintel.com (AnalystPass123!)');
  }

  // 2. Initialize queue
  JobQueue.init();

  // 3. Ingest sample documents from datasets/invoices
  const sampleDir = path.resolve('datasets/invoices');
  const uploadDir = path.resolve(env.UPLOAD_DIR);
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const sampleFiles = [
    'INV-2026-001_ApexSolutions.pdf',
    'INV-2026-002_EnterpriseMultiPage.pdf',
    'INV-2026-003_NordicRetail.xlsx',
    'INV-2026-004_DeltaSupplies.csv',
    'INV-2026-005_MathDiscrepancy.csv',
    'PO-2026-003_MetroSuperstores.xlsx',
  ];

  const fakeMulterFiles: Express.Multer.File[] = [];

  for (const filename of sampleFiles) {
    const srcPath = path.join(sampleDir, filename);
    if (!fs.existsSync(srcPath)) continue;

    const uniqueName = `${uuidv4()}${path.extname(filename)}`;
    const destPath = path.join(uploadDir, uniqueName);
    fs.copyFileSync(srcPath, destPath);

    fakeMulterFiles.push({
      fieldname: 'files',
      originalname: filename,
      encoding: '7bit',
      mimetype: filename.endsWith('.pdf')
        ? 'application/pdf'
        : filename.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
      size: fs.statSync(destPath).size,
      destination: uploadDir,
      filename: uniqueName,
      path: destPath,
      buffer: Buffer.alloc(0),
      stream: null as any,
    });
  }

  const uploaded = await DocumentService.uploadDocuments(fakeMulterFiles);
  console.log(`✅ Uploaded and queued ${uploaded.length} sample document(s).`);

  // Wait for queue to process documents
  console.log('⏳ Waiting for background queue processing...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Cross verify INV-2026-003 with PO-2026-003
  const docInv = db.prepare("SELECT id FROM documents WHERE original_name LIKE '%INV-2026-003%'").get() as any;
  const docPo = db.prepare("SELECT id FROM documents WHERE original_name LIKE '%PO-2026-003%'").get() as any;

  if (docInv && docPo) {
    try {
      const cvResult = await VerificationService.crossVerify(docInv.id, docPo.id);
      console.log(`✅ Seeded cross-verification between Invoice and PO: Score = ${cvResult.matchScore}%`);
    } catch (err: any) {
      console.warn('Cross-verification seed notice:', err.message);
    }
  }

  console.log('🎉 Seeding complete!');
  process.exit(0);
}

seed().catch(console.error);


const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer'); // Yeni eklendi

// Firebase yapılandırması
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://acele-kumulastirma-default-rtdb.europe-west1.firebasedatabase.app'
  });
}
const db = admin.database();
const kamulastirmaRef = db.ref('kamulastirma');

// Kategori eşleme
const kategoriMapping = {
  'Enerji İletim/Dağıtım': 'Enerji İletim/Dağıtım',
  'Demiryolu/Raylı Sistem': 'Demiryolu/Raylı Sistem',
  'Doğal Gaz': 'Doğal Gaz',
  'GES': 'GES (Güneş/Biyogaz Enerjisi)',
  'HES': 'HES (Hidroelektrik)',
  'Su/Sulama/Baraj': 'Su/Sulama/Baraj',
  'Afet/Deprem': 'Afet/Deprem',
  'Maden/Petrol': 'Maden/Petrol',
  'Karayolu': 'Karayolu',
  'Kentsel Dönüşüm': 'Kentsel Dönüşüm',
  'Konut': 'Konut (TOKİ/Sosyal)',
  'RES': 'RES (Rüzgar Enerjisi)',
  'Sanayi Bölgesi': 'Sanayi Bölgesi (OSB)',
  'Arkeoloji': 'Arkeoloji/Kültürel Miras'
};

function normalizeCategory(text) {
  for (const [key, value] of Object.entries(kategoriMapping)) {
    if (text.includes(key)) return value;
  }
  return 'Diğer';
}

function extractCity(locationText) {
  // Türkiye illeri listesi
  const cities = [
    'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya', 'Ardahan', 'Artvin',
    'Aydın', 'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur',
    'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan',
    'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkâri', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul',
    'İzmir', 'Kahramanmaraş', 'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kırıkkale', 'Kırklareli',
    'Kırşehir', 'Kilis', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla',
    'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Şanlıurfa', 'Siirt',
    'Sinop', 'Sivas', 'Şırnak', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak'
  ];
  
  for (const city of cities) {
    if (locationText.includes(city)) return city;
  }
  return locationText.split(/[\/,]/)[0].trim() || 'Belirtilmemiş';
}

async function fetchResmiGazetePage(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const url = `https://www.resmigazete.gov.tr/eskiler/${year}/${month}/${year}${month}${day}.htm`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AceleKamulastirmaBot/1.0; +https://github.com/your-repo)'
      },
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.log(`${date.toISOString().split('T')[0]} için Resmî Gazete bulunamadı`);
    return null;
  }
}

function extractKamulastirmaKararlari(html) {
  const $ = cheerio.load(html);
  const kararlar = [];
  
  // "Acele Kamulaştırma" içeren metinleri ara
  $('p, div, td').each((i, elem) => {
    const text = $(elem).text();
    if (text.includes('Acele Kamulaştırılması') || text.includes('ACELE KAMULAŞTIRMA')) {
      // Karar numarasını çıkar
      const kararNoMatch = text.match(/Karar Sayısı[:\s]*(\d+)/i);
      const tarihMatch = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
      
      // Proje adını çıkar
      let projeAdi = text.split('\n')[0].substring(0, 150);
      
      // Kategori belirleme
      let kategori = 'Diğer';
      const kategoriKeywords = {
        'enerji iletim': 'Enerji İletim/Dağıtım',
        'demiryolu': 'Demiryolu/Raylı Sistem',
        'doğal gaz': 'Doğal Gaz',
        'ges': 'GES (Güneş/Biyogaz Enerjisi)',
        'hes': 'HES (Hidroelektrik)',
        'sulama': 'Su/Sulama/Baraj',
        'baraj': 'Su/Sulama/Baraj',
        'deprem': 'Afet/Deprem',
        'maden': 'Maden/Petrol',
        'petrol': 'Maden/Petrol',
        'karayolu': 'Karayolu',
        'kentsel dönüşüm': 'Kentsel Dönüşüm',
        'toki': 'Konut (TOKİ/Sosyal)',
        'konut': 'Konut (TOKİ/Sosyal)',
        'rüzgar': 'RES (Rüzgar Enerjisi)',
        'res': 'RES (Rüzgar Enerjisi)',
        'sanayi': 'Sanayi Bölgesi (OSB)',
        'arkeoloji': 'Arkeoloji/Kültürel Miras'
      };
      
      for (const [keyword, cat] of Object.entries(kategoriKeywords)) {
        if (text.toLowerCase().includes(keyword)) {
          kategori = cat;
          break;
        }
      }
      
      // Konum çıkar
      let konum = 'Belirtilmemiş';
      const locationMatch = text.match(/([A-ZİĞÜŞÖÇ][a-zığüşöç]+)\s+İli/i);
      if (locationMatch) konum = locationMatch[1];
      
      // Kurum çıkar
      let kurum = '';
      const kurumMatch = text.match(/([A-ZİĞÜŞÖÇ][a-zığüşöç\s]+(Bakanlığı|Müdürlüğü|Başkanlığı|İdaresi))/i);
      if (kurumMatch) kurum = kurumMatch[1];
      
      kararlar.push({
        proje_adi: projeAdi,
        karar_sayisi: kararNoMatch ? kararNoMatch[1] : '',
        tarih: tarihMatch ? tarihMatch[0] : '',
        tahmini_konum: extractCity(konum),
        kamulastiran_kurum: kurum,
        resmi_gazete_sayisi: '',
        coordinates: null,
        kategori: kategori,
        eklenme_tarihi: new Date().toISOString()
      });
    }
  });
  
  return kararlar;
}

async function geocodeLocation(location) {
  if (!location || location === 'Belirtilmemiş') return null;
  
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: `${location}, Türkiye`,
        format: 'json',
        limit: 1,
        'accept-language': 'tr'
      },
      headers: {
        'User-Agent': 'AceleKamulastirmaBot/1.0'
      },
      timeout: 5000
    });
    
    if (response.data && response.data.length > 0) {
      return [parseFloat(response.data[0].lon), parseFloat(response.data[0].lat)];
    }
  } catch (error) {
    console.error(`Geocode hatası (${location}):`, error.message);
  }
  return null;
}

async function updateFirebase(kararlar) {
  let addedCount = 0;
  let skippedCount = 0;
  const addedKararlar = []; // E-posta için eklenecek kararları tut
  
  for (const karar of kararlar) {
    // Aynı karar numarası ile daha önce eklenmiş mi kontrol et
    const snapshot = await kamulastirmaRef.orderByChild('karar_sayisi').equalTo(karar.karar_sayisi).once('value');
    if (snapshot.exists()) {
      console.log(`Karar ${karar.karar_sayisi} zaten mevcut, atlanıyor`);
      skippedCount++;
      continue;
    }
    
    // Koordinat ekle
    if (!karar.coordinates && karar.tahmini_konum !== 'Belirtilmemiş') {
      karar.coordinates = await geocodeLocation(karar.tahmini_konum);
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
    
    // Firebase'e ekle
    const newRef = await kamulastirmaRef.push(karar);
    addedCount++;
    addedKararlar.push({ ...karar, id: newRef.key });
    console.log(`Yeni karar eklendi: ${karar.proje_adi.substring(0, 50)}...`);
  }
  
  console.log(`Güncelleme tamamlandı: ${addedCount} yeni eklendi, ${skippedCount} atlandı`);
  return { addedCount, skippedCount, addedKararlar };
}

async function updateGeoJSONFile() {
  const snapshot = await kamulastirmaRef.once('value');
  const data = snapshot.val();
  const kamulastirmaList = data ? Object.entries(data).map(([id, val]) => ({ id, ...val })) : [];
  
  const geojson = {
    type: 'FeatureCollection',
    name: 'Acele Kamulaştırma Kararları',
    crs: {
      type: 'name',
      properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' }
    },
    metadata: {
      created: new Date().toISOString(),
      total: kamulastirmaList.length,
      kategoriler: [...new Set(kamulastirmaList.map(k => k.kategori))]
    },
    features: kamulastirmaList
      .filter(item => item.coordinates && Array.isArray(item.coordinates))
      .map(item => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: Array.isArray(item.coordinates[0]) 
            ? [item.coordinates[0][0], item.coordinates[0][1]] 
            : item.coordinates
        },
        properties: {
          proje_adi: item.proje_adi,
          karar_sayisi: item.karar_sayisi,
          tarih: item.tarih,
          kategori: item.kategori,
          tahmini_konum: item.tahmini_konum,
          yil: item.tarih ? item.tarih.split('.')[2] : '',
          resmi_gazete_linki: item.tarih ? `https://www.resmigazete.gov.tr/fihrist?tarih=${item.tarih.split('.').reverse().join('-')}` : '',
          kamulastiran_kurum: item.kamulastiran_kurum
        }
      }))
  };
  
  const geojsonPath = path.join(__dirname, '..', '2023-2026 Acele Kamulaştırma01.geojson');
  fs.writeFileSync(geojsonPath, JSON.stringify(geojson, null, 2), 'utf-8');
  console.log(`GeoJSON güncellendi: ${kamulastirmaList.length} kayıt`);
}

// ==================== E-POSTA BİLDİRİM FONKSİYONU ====================
async function sendEmailNotification(addedCount, skippedCount, addedKararlar, totalRecords) {
  // E-posta gönderimi için environment variable'ları kontrol et
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  const emailTo = process.env.EMAIL_TO || emailUser; // Varsayılan olarak kendine gönder
  
  if (!emailUser || !emailPass) {
    console.log('📧 E-posta bildirimi için EMAIL_USER veya EMAIL_PASS ayarlanmamış');
    return;
  }
  
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      }
    });
    
    // Eklenecek kararlar için HTML tablosu oluştur
    let kararlarHtml = '';
    if (addedKararlar.length > 0) {
      kararlarHtml = `
        <h3>📋 Yeni Eklenen Kararlar (${addedKararlar.length} adet)</h3>
        <table style="border-collapse: collapse; width: 100%; margin-top: 15px;">
          <thead>
            <tr>
              <th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;">Proje Adı</th>
              <th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;">Karar No</th>
              <th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;">Kategori</th>
              <th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;">Konum</th>
              <th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;">Tarih</th>
            </tr>
          </thead>
          <tbody>
      `;
      
      addedKararlar.forEach(k => {
        kararlarHtml += `
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${k.proje_adi.substring(0, 60)}${k.proje_adi.length > 60 ? '...' : ''}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${k.karar_sayisi || '-'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${k.kategori}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${k.tahmini_konum}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${k.tarih || '-'}</td>
          </tr>
        `;
      });
      
      kararlarHtml += `
          </tbody>
        </table>
      `;
    } else {
      kararlarHtml = '<p style="color: #666;">📭 Bugün için yeni karar bulunamadı.</p>';
    }
    
    const mailOptions = {
      from: `"Acele Kamulaştırma Bot" <${emailUser}>`,
      to: emailTo,
      subject: `📢 Kamulaştırma Veri Güncellemesi - ${new Date().toLocaleDateString('tr-TR')}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 800px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: white; padding: 20px; border-radius: 10px; text-align: center; }
            .stats { background: #f5f7fb; padding: 15px; border-radius: 8px; margin: 20px 0; }
            .stat-item { display: inline-block; margin: 0 20px; text-align: center; }
            .stat-number { font-size: 28px; font-weight: bold; color: #2a5298; }
            .stat-label { font-size: 12px; color: #666; margin-top: 5px; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center; }
            .button { display: inline-block; background: #2a5298; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 15px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>🏛️ Acele Kamulaştırma Günlük Raporu</h2>
              <p>${new Date().toLocaleString('tr-TR')}</p>
            </div>
            
            <div class="stats">
              <div class="stat-item">
                <div class="stat-number">${addedCount}</div>
                <div class="stat-label">Yeni Eklenen</div>
              </div>
              <div class="stat-item">
                <div class="stat-number">${skippedCount}</div>
                <div class="stat-label">Atlanan (Mevcut)</div>
              </div>
              <div class="stat-item">
                <div class="stat-number">${totalRecords}</div>
                <div class="stat-label">Toplam Kayıt</div>
              </div>
            </div>
            
            ${kararlarHtml}
            
            <div style="text-align: center;">
              <a href="https://acele-kumulastirma.firebaseapp.com" class="button">🗺️ Web Uygulamasını Aç</a>
              <a href="https://github.com/your-repo/acele-kamulastirma/actions" class="button" style="background: #8b5cf6;">🔄 İşlem Geçmişi</a>
            </div>
            
            <div class="footer">
              <p>Bu e-posta otomatik olarak gönderilmiştir. | Acele Kamulaştırma Takip Sistemi</p>
              <p>Kaynak: Resmî Gazete • Güncelleme: ${new Date().toLocaleString('tr-TR')}</p>
            </div>
          </div>
        </body>
        </html>
      `
    };
    
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 E-posta gönderildi: ${info.messageId}`);
    
  } catch (error) {
    console.error('❌ E-posta gönderim hatası:', error.message);
  }
}

// ==================== ANA FONKSİYON ====================
async function main() {
  console.log('🚀 Günlük veri toplama başladı:', new Date().toISOString());
  
  // Son 7 günü tara
  const sonGunler = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    sonGunler.push(date);
  }
  
  let allKararlar = [];
  
  for (const date of sonGunler) {
    const html = await fetchResmiGazetePage(date);
    if (html) {
      const kararlar = extractKamulastirmaKararlari(html);
      allKararlar.push(...kararlar);
      console.log(`${date.toISOString().split('T')[0]}: ${kararlar.length} karar bulundu`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Tekilleştir
  const uniqueKararlar = [];
  const seenKeys = new Set();
  for (const karar of allKararlar) {
    const key = `${karar.karar_sayisi}-${karar.proje_adi.substring(0, 50)}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueKararlar.push(karar);
    }
  }
  
  console.log(`${uniqueKararlar.length} tekil karar işlenecek`);
  
  let addedCount = 0, skippedCount = 0, addedKararlar = [];
  let totalRecords = 0;
  
  if (uniqueKararlar.length > 0) {
    const result = await updateFirebase(uniqueKararlar);
    addedCount = result.addedCount;
    skippedCount = result.skippedCount;
    addedKararlar = result.addedKararlar;
    
    await updateGeoJSONFile();
    
    // Toplam kayıt sayısını al
    const snapshot = await kamulastirmaRef.once('value');
    totalRecords = snapshot.numChildren();
    
    console.log(`✅ İşlem tamamlandı. Eklendi: ${addedCount}, Atlanan: ${skippedCount}`);
    
    // ==================== E-POSTA BİLDİRİMİ ====================
    await sendEmailNotification(addedCount, skippedCount, addedKararlar, totalRecords);
    
  } else {
    console.log('📭 Yeni karar bulunamadı');
    
    // Yeni karar bulunmasa da rapor gönder
    const snapshot = await kamulastirmaRef.once('value');
    totalRecords = snapshot.numChildren();
    await sendEmailNotification(0, 0, [], totalRecords);
  }
}

main().catch(console.error);

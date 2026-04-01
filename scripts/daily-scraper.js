const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

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

function extractCoordinates(text) {
  // Koordinat çıkarımı için regex (basit yaklaşım)
  const coordPattern = /(\d{2,3})[°\s]*(\d{1,2})[°\s]*(\d{1,2})?[.,]?\s*([NSEW])/gi;
  // Bu kısım daha detaylı geliştirilebilir
  return null; // Şimdilik null döndür, Nominatim kullanılacak
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
      // Karar numarasını çıkar (varsayılan format)
      const kararNoMatch = text.match(/Karar Sayısı[:\s]*(\d+)/i);
      const tarihMatch = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
      
      // Proje adını çıkar (karar başlığından)
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
        coordinates: null, // Sonradan Nominatim ile eklenecek
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
  
  for (const karar of kararlar) {
    // Aynı karar numarası veya proje adı ile daha önce eklenmiş mi kontrol et
    const snapshot = await kamulastirmaRef.orderByChild('karar_sayisi').equalTo(karar.karar_sayisi).once('value');
    if (snapshot.exists()) {
      console.log(`Karar ${karar.karar_sayisi} zaten mevcut, atlanıyor`);
      skippedCount++;
      continue;
    }
    
    // Koordinat ekle (eğer yoksa)
    if (!karar.coordinates && karar.tahmini_konum !== 'Belirtilmemiş') {
      karar.coordinates = await geocodeLocation(karar.tahmini_konum);
      // Rate limit için bekle
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
    
    // Firebase'e ekle
    await kamulastirmaRef.push(karar);
    addedCount++;
    console.log(`Yeni karar eklendi: ${karar.proje_adi.substring(0, 50)}...`);
  }
  
  console.log(`Güncelleme tamamlandı: ${addedCount} yeni eklendi, ${skippedCount} atlandı`);
  return { addedCount, skippedCount };
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

async function main() {
  console.log('Günlük veri toplama başladı:', new Date().toISOString());
  
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
    // Rate limit için bekle
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
  
  if (uniqueKararlar.length > 0) {
    const { addedCount, skippedCount } = await updateFirebase(uniqueKararlar);
    await updateGeoJSONFile();
    console.log(`İşlem tamamlandı. Eklendi: ${addedCount}, Atlanan: ${skippedCount}`);
  } else {
    console.log('Yeni karar bulunamadı');
  }
}

main().catch(console.error);

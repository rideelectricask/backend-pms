const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/your_database';

const merchantOrderSchema = new mongoose.Schema({
  merchant_order_id: String,
  weight: Number,
  sender_name: String,
  sender_phone: String,
  consignee_name: String,
  consignee_phone: String,
  destination_city: String,
  destination_postalcode: String,
  destination_address: String,
  dropoff_lat: Number,
  dropoff_long: Number,
  payment_type: String,
  item_value: Number,
  product_details: String
}, { timestamps: true });

async function checkAndFixCoordinates() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const project = process.argv[2] || 'mup';
    const merchantOrderId = process.argv[3];
    
    const collectionName = `${project}_merchant_orders`;
    const MerchantOrder = mongoose.model(collectionName, merchantOrderSchema, collectionName);

    let query = {};
    if (merchantOrderId) {
      query.merchant_order_id = merchantOrderId;
    }

    const orders = await MerchantOrder.find(query);
    
    console.log(`\n📊 Checking ${orders.length} order(s)...\n`);

    for (const order of orders) {
      console.log(`\n📦 Order: ${order.merchant_order_id}`);
      console.log(`   📍 Coordinates:`);
      console.log(`      Lat: ${order.dropoff_lat || 0}`);
      console.log(`      Long: ${order.dropoff_long || 0}`);
      
      const issues = [];
      
      if (!order.dropoff_lat || order.dropoff_lat === 0) {
        issues.push('❌ dropoff_lat is 0 or missing');
      }
      
      if (!order.dropoff_long || order.dropoff_long === 0) {
        issues.push('❌ dropoff_long is 0 or missing');
      }

      if (order.dropoff_lat && (order.dropoff_lat < -90 || order.dropoff_lat > 90)) {
        issues.push('❌ dropoff_lat out of range (-90 to 90)');
      }

      if (order.dropoff_long && (order.dropoff_long < -180 || order.dropoff_long > 180)) {
        issues.push('❌ dropoff_long out of range (-180 to 180)');
      }

      if (!order.payment_type || !['cod', 'non_cod'].includes(order.payment_type)) {
        issues.push('❌ payment_type invalid or missing');
      }

      if (!order.item_value || order.item_value === 0) {
        issues.push('⚠️ item_value is 0');
      }

      if (!order.product_details || order.product_details.trim() === '') {
        issues.push('⚠️ product_details is empty');
      }

      if (issues.length > 0) {
        console.log(`   ⚠️ Issues found:`);
        issues.forEach(issue => console.log(`      ${issue}`));
        
        const defaultLat = -6.2088;
        const defaultLong = 106.8456;
        
        console.log(`\n   💡 Suggested fix:`);
        console.log(`   db.${collectionName}.updateOne(`);
        console.log(`     { merchant_order_id: "${order.merchant_order_id}" },`);
        console.log(`     { $set: {`);
        
        if (!order.dropoff_lat || order.dropoff_lat === 0) {
          console.log(`       dropoff_lat: ${defaultLat},`);
        }
        if (!order.dropoff_long || order.dropoff_long === 0) {
          console.log(`       dropoff_long: ${defaultLong},`);
        }
        if (!order.payment_type || !['cod', 'non_cod'].includes(order.payment_type)) {
          console.log(`       payment_type: "non_cod",`);
        }
        if (!order.item_value || order.item_value === 0) {
          console.log(`       item_value: 100000,`);
        }
        if (!order.product_details || order.product_details.trim() === '') {
          console.log(`       product_details: "General Items"`);
        }
        
        console.log(`     } }`);
        console.log(`   )`);
        
        console.log(`\n   🔧 Auto-fix available. Run with --fix flag to apply.`);
      } else {
        console.log(`   ✅ All fields OK`);
      }
    }

    if (process.argv.includes('--fix')) {
      console.log(`\n🔧 Applying fixes...`);
      
      const defaultLat = -6.2088;
      const defaultLong = 106.8456;
      
      for (const order of orders) {
        const updates = {};
        
        if (!order.dropoff_lat || order.dropoff_lat === 0) {
          updates.dropoff_lat = defaultLat;
        }
        
        if (!order.dropoff_long || order.dropoff_long === 0) {
          updates.dropoff_long = defaultLong;
        }

        if (!order.payment_type || !['cod', 'non_cod'].includes(order.payment_type)) {
          updates.payment_type = 'non_cod';
          updates.cod_amount = 0;
        }

        if (!order.item_value || order.item_value === 0) {
          updates.item_value = 100000;
        }

        if (!order.product_details || order.product_details.trim() === '') {
          updates.product_details = 'General Items';
        }

        if (Object.keys(updates).length > 0) {
          await MerchantOrder.updateOne(
            { _id: order._id },
            { $set: updates }
          );
          
          console.log(`✅ Fixed: ${order.merchant_order_id}`);
          console.log(`   Updated fields: ${Object.keys(updates).join(', ')}`);
        }
      }
      
      console.log(`\n✅ All fixes applied!`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkAndFixCoordinates();
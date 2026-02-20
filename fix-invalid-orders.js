const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://myangkasasa:TWqn97nDT116e2DX@cluster0.nrt1pdw.mongodb.net/pms';

const merchantOrderSchema = new mongoose.Schema({
  merchant_order_id: String,
  weight: Number,
  width: Number,
  height: Number,
  length: Number,
  payment_type: String,
  cod_amount: Number,
  sender_name: String,
  sender_phone: String,
  pickup_instructions: String,
  consignee_name: String,
  consignee_phone: String,
  destination_district: String,
  destination_city: String,
  destination_province: String,
  destination_postalcode: String,
  destination_address: String,
  dropoff_lat: Number,
  dropoff_long: Number,
  dropoff_instructions: String,
  item_value: Number,
  product_details: String,
  assigned_to_driver_id: String,
  assignment_status: String,
  batch_id: Number
}, { timestamps: true });

async function fixInvalidOrders() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const project = process.argv[2] || 'mup';
    const collectionName = `${project}_merchant_orders`;
    
    const MerchantOrder = mongoose.model(collectionName, merchantOrderSchema, collectionName);

    console.log(`\n🔍 Checking ${collectionName} for invalid orders...`);

    const allOrders = await MerchantOrder.find({});
    console.log(`📊 Total orders: ${allOrders.length}`);

    const invalidOrders = [];

    for (const order of allOrders) {
      const errors = [];

      if (!order.merchant_order_id || order.merchant_order_id.trim() === '') errors.push('merchant_order_id');
      if (!order.weight || order.weight <= 0) errors.push('weight');
      if (!order.sender_name || order.sender_name.trim() === '') errors.push('sender_name');
      if (!order.sender_phone || order.sender_phone.trim() === '') errors.push('sender_phone');
      if (!order.consignee_name || order.consignee_name.trim() === '') errors.push('consignee_name');
      if (!order.consignee_phone || order.consignee_phone.trim() === '') errors.push('consignee_phone');
      if (!order.destination_city || order.destination_city.trim() === '') errors.push('destination_city');
      if (!order.destination_postalcode || order.destination_postalcode.trim() === '') errors.push('destination_postalcode');
      if (!order.destination_address || order.destination_address.trim() === '') errors.push('destination_address');

      if (errors.length > 0) {
        invalidOrders.push({
          _id: order._id,
          merchant_order_id: order.merchant_order_id,
          errors
        });
      }
    }

    if (invalidOrders.length === 0) {
      console.log('✅ No invalid orders found!');
      process.exit(0);
    }

    console.log(`\n❌ Found ${invalidOrders.length} invalid order(s):`);
    invalidOrders.forEach((inv, idx) => {
      console.log(`\n${idx + 1}. ${inv.merchant_order_id || 'NO ID'}`);
      console.log(`   Missing fields: ${inv.errors.join(', ')}`);
    });

    console.log(`\n💡 To fix these orders, you need to:`);
    console.log(`   1. Update the Excel file with complete data`);
    console.log(`   2. Re-upload the corrected data`);
    console.log(`   3. Or manually update in database`);

    console.log(`\n📋 Example fix for first invalid order:`);
    if (invalidOrders.length > 0) {
      const firstInvalid = invalidOrders[0];
      console.log(`\ndb.${collectionName}.updateOne(`);
      console.log(`  { _id: ObjectId("${firstInvalid._id}") },`);
      console.log(`  { $set: {`);
      
      if (firstInvalid.errors.includes('weight')) {
        console.log(`    weight: 1.0,`);
      }
      if (firstInvalid.errors.includes('sender_name')) {
        console.log(`    sender_name: "Warehouse Name",`);
      }
      if (firstInvalid.errors.includes('sender_phone')) {
        console.log(`    sender_phone: "081234567890",`);
      }
      if (firstInvalid.errors.includes('consignee_name')) {
        console.log(`    consignee_name: "Customer Name",`);
      }
      if (firstInvalid.errors.includes('consignee_phone')) {
        console.log(`    consignee_phone: "081298765432",`);
      }
      if (firstInvalid.errors.includes('destination_city')) {
        console.log(`    destination_city: "Jakarta",`);
      }
      if (firstInvalid.errors.includes('destination_postalcode')) {
        console.log(`    destination_postalcode: "12345",`);
      }
      if (firstInvalid.errors.includes('destination_address')) {
        console.log(`    destination_address: "Jl. Example No. 123",`);
      }
      
      console.log(`  } }`);
      console.log(`)`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

fixInvalidOrders();
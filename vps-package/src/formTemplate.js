'use strict';

/**
 * قالب صفحهٔ وب «فرم ثبت شکایت / دادخواست»
 * - دقیقاً بر اساس طرح رسمی فرم (بسمه‌تعالی، بخش‌بندی، متشاکی(شکایت‌شده) ۱ تا ۱۰ نفر)
 * - شمارهٔ ثبت و تاریخ ثبت به‌صورت خودکار از ربات پر می‌شود
 * - انتخاب وکیل از منو (نام + تعداد پرونده‌های قبول‌شده)
 * - ارسال به ربات از طریق POST /submit — پرونده مستقیم در کانال شکایات منتشر می‌شود
 */

const HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>فرم ثبت شکایت / دادخواست</title>
<style>
body{font-family:Tahoma,Arial,sans-serif;background:#f4f6f8;margin:0;padding:24px;color:#14253a}
.form{max-width:1000px;margin:auto;background:#fff;border:2px solid #183b5b;border-radius:10px;padding:24px;box-shadow:0 4px 18px #0001}
h1{text-align:center;font-size:26px;margin:5px 0 8px}.subtitle{text-align:center;color:#555;margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.full{grid-column:1/-1}
.section{margin-top:24px;border:1.5px solid #234d70;border-radius:7px;overflow:hidden}
.section h2{font-size:18px;margin:0;padding:10px 14px;background:#183b5b;color:#fff}
.section-body{padding:16px}label{display:block;font-weight:bold;margin-bottom:6px}
input,textarea,select{width:100%;box-sizing:border-box;border:1px solid #aeb9c4;border-radius:5px;padding:10px;font-family:inherit;font-size:14px;background:#fff}
textarea{min-height:150px;resize:vertical}.required{color:#b00020}
.actions{display:flex;gap:10px;justify-content:center;margin-top:24px}
button{border:0;border-radius:6px;padding:11px 28px;font-family:inherit;font-size:15px;cursor:pointer}
.primary{background:#183b5b;color:#fff}.secondary{background:#e9edf1}
.msg{text-align:center;margin-top:15px;font-weight:bold}
.defendant-card{border:1px dashed #7f9cb8;border-radius:6px;padding:12px;margin-top:10px}
@media(max-width:700px){.grid{grid-template-columns:1fr}.full{grid-column:auto}}
@media print{body{background:#fff;padding:0}.form{box-shadow:none;border:0;max-width:none}.actions,.msg{display:none}}
</style>
</head>
<body>
<form class="form" id="complaintForm">
<div style="text-align:center">بسمه تعالی</div>
<h1>فرم ثبت شکایت / دادخواست</h1>
<div class="subtitle">به منظور پیگیری امور قضایی و حقوقی</div>

<div class="grid">
<div><label>شماره ثبت</label><input name="registration_no" id="registrationNo" readonly></div>
<div><label>تاریخ ثبت</label><input name="registration_date" id="registrationDate" readonly></div>
</div>

<section class="section"><h2>اطلاعات شاکی</h2><div class="section-body"><div class="grid">
<div><label>نام <span class="required">*</span></label><input name="complainant_first_name" required></div>
<div><label>نام خانوادگی <span class="required">*</span></label><input name="complainant_last_name" required></div>
<div><label>نام پدر</label><input name="complainant_father"></div>
<div><label>شناسه / کد ملی</label><input name="complainant_id"></div>
<div><label>شماره تماس <span class="required">*</span></label><input name="complainant_phone" required></div>
<div><label>شغل / سمت</label><input name="complainant_job"></div>
<div class="full"><label>محل اقامت (شهر، استان، آدرس کامل، کدپستی)</label><input name="complainant_address"></div>
<div class="full"><label>وکیل یا نماینده قانونی <span style="font-weight:normal;color:#555">(شماره تماس، تعداد پرونده، برد و باخت هر وکیل کنار نامش نوشته شده)</span></label><select name="complainant_lawyer" id="lawyerSelect" style="padding:12px;font-size:15px"><option value="novakil">در حال دریافت فهرست وکلا…</option></select></div>
</div></div></section>

<section class="section">
<h2>اطلاعات متشاکی(شکایت‌شده)</h2>
<div class="section-body">
<div class="grid">
<div class="full">
<label>تعداد متشاکی(شکایت‌شده) <span class="required">*</span></label>
<select id="defendantCount" name="defendant_count" required>
<option value="1" selected>۱ نفر</option>
<option value="2">۲ نفر</option><option value="3">۳ نفر</option>
<option value="4">۴ نفر</option><option value="5">۵ نفر</option>
<option value="6">۶ نفر</option><option value="7">۷ نفر</option>
<option value="8">۸ نفر</option><option value="9">۹ نفر</option>
<option value="10">۱۰ نفر</option>
</select>
</div>
<div class="full" id="defendantsContainer"></div>
</div>
</div>
</section>

<section class="section"><h2>موضوع و جزئیات شکایت</h2><div class="section-body"><div class="grid">
<div class="full"><label>موضوع شکایت / دادخواست <span class="required">*</span></label><input name="subject" required></div>
<div><label>تاریخ وقوع موضوع</label><input name="incident_date" placeholder="مثلاً ۱۴۰۵/۰۶/۲۸"></div>
<div><label>محل وقوع موضوع</label><input name="incident_location"></div>
<div class="full"><label>زمان و نشانی محل وقوع</label><input name="incident_address"></div>
<div class="full"><label>دلایل و شواهد</label><textarea name="evidence"></textarea></div>
<div class="full"><label>شرح کامل شکایت / دادخواست <span class="required">*</span></label><textarea name="description" style="min-height:260px" required></textarea></div>
<div class="full"><label>خواسته / درخواست شاکی</label><textarea name="request" style="min-height:140px"></textarea></div>
</div></div></section>

<section class="section"><h2>تأیید و ارسال</h2><div class="section-body">
<label><input type="checkbox" name="confirm" required style="width:auto"> صحت اطلاعات واردشده را تأیید می‌کنم.</label>
<div class="actions">
<button type="submit" class="primary">ثبت فرم</button>
<button type="button" class="secondary" onclick="window.print()">چاپ فرم</button>
<button type="reset" class="secondary">پاک کردن</button>
</div>
<div id="msg" class="msg"></div>
</div></section>
</form>

<script>
const form = document.getElementById('complaintForm');
const countSelect = document.getElementById('defendantCount');
const defendantsContainer = document.getElementById('defendantsContainer');

const params = new URLSearchParams(location.search);
const UID = params.get('u') || '';
const TOKEN = params.get('t') || '';

function makeDefendant(index){
 const n = index + 1;
 const wrap = document.createElement('div');
 wrap.className = 'defendant-card';
 wrap.innerHTML = \`
   <div style="font-weight:bold;background:#eef3f7;padding:10px;border-radius:5px;margin:12px 0">
     متشاکی(شکایت‌شده) شماره \${n}
   </div>
   <div class="grid">
     <div><label>نام <span class="required">*</span></label><input name="defendant_\${n}_first_name" required></div>
     <div><label>نام خانوادگی <span class="required">*</span></label><input name="defendant_\${n}_last_name" required></div>
     <div><label>نام پدر</label><input name="defendant_\${n}_father"></div>
     <div><label>شماره تماس</label><input name="defendant_\${n}_phone"></div>
     <div><label>شغل / سمت</label><input name="defendant_\${n}_job"></div>
     <div><label>نوع ارتباط با شاکی</label><input name="defendant_\${n}_relationship"></div>
     <div class="full"><label>محل اقامت / محل فعالیت</label><input name="defendant_\${n}_address"></div>
   </div>\`;
 return wrap;
}

function renderDefendants(){
 defendantsContainer.innerHTML = '';
 const count = Math.max(1, Math.min(10, Number(countSelect.value) || 1));
 for(let i=0;i<count;i++) defendantsContainer.appendChild(makeDefendant(i));
}
countSelect.addEventListener('change', renderDefendants);
renderDefendants();

// دریافت شمارهٔ ثبت، تاریخ ثبت و فهرست وکلا از ربات
(async () => {
  const msg = document.getElementById('msg');
  try {
    const r = await fetch('/api/meta?u=' + encodeURIComponent(UID) + '&t=' + encodeURIComponent(TOKEN));
    const j = await r.json();
    if (!j.ok) { msg.textContent = j.message || 'دسترسی نامعتبر — فرم را از داخل دیسکورد با /shekayat باز کنید.'; return; }
    document.getElementById('registrationNo').value = j.registrationNo;
    document.getElementById('registrationDate').value = j.registrationDate;
    const sel = document.getElementById('lawyerSelect');
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = 'novakil'; none.textContent = 'بدون وکیل'; // گزینهٔ اول
    sel.appendChild(none);
    for (const v of j.vakils) {
      const o = document.createElement('option');
      o.value = v.value; o.textContent = v.label;
      sel.appendChild(o);
    }
    if (j.openCase) msg.textContent = '⚠️ شما یک پروندهٔ باز دارید؛ تا بسته‌شدن آن امکان ثبت جدید نیست.';
  } catch (e) {
    msg.textContent = 'خطا در ارتباط با سرور ربات';
  }
})();

form.addEventListener('submit', async function(e){
 e.preventDefault();
 const data = Object.fromEntries(new FormData(this).entries());
 data.u = UID; data.t = TOKEN;
 const btn = this.querySelector('button.primary');
 btn.disabled = true;
 try{
   const r = await fetch('/submit',{
     method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify(data)
   });
   const j = await r.json();
   document.getElementById('msg').textContent = j.message;
   if(j.ok){
     form.reset();
     renderDefendants();
     location.reload();
   }
 }catch(e){
   document.getElementById('msg').textContent='خطا در ارتباط با سرور';
 }finally{
   btn.disabled = false;
 }
});
</script>
</body>
</html>`;

module.exports = { HTML };

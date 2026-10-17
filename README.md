# منسّق المذكرات (Vercel + Gemini مجاناً)

الخطوات الكاملة في الرد على المحادثة. ملخصها:
1. مفتاح من https://aistudio.google.com  (Get API key)
2. ارفع هذا المجلد إلى GitHub (مستودع جديد)
3. في vercel.com: Add New → Project → اختر المستودع → قبل Deploy أضف المتغيرات:
   GEMINI_API_KEY = مفتاحك
   MODEL = اسم نموذج Flash المجاني كما يظهر في AI Studio
   MAX_PER_MIN = 6
4. Deploy، ثم افتح الرابط وجرّب مذكرة.

بدون المفتاح أو عند انتهاء الحصة المجانية يعمل الموقع بالقواعد الثابتة تلقائياً.

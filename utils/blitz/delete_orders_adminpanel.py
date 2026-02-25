import requests

SESSION_ID = "flh04gb9jhbfsbpos71i7n4kemsuckn5"
CSRF_TOKEN = "lXwZgQpOovupgg4y1ScGUAuMW297W2pw"
BASE_URL = "https://adminpanel.rideblitz.id"

AWB_NUMBERS = [
    "BEMAWB-00001061978",
    "BEMAWB-00001061979",
    "BEMAWB-00001061991",
    "BEMAWB-00001061993",
    "BEMAWB-00001062002",
    "BEMAWB-00001064862",
    "BEMAWB-00001064872",
    "BEMAWB-00001064937",
    "BEMAWB-00001067090",
    "BEMAWB-00001061986",
    "BEMAWB-00001067089",
    "BEMAWB-00001064873",
    "BEMAWB-00001064936",
    "BEMAWB-00001071986",
    "BEMAWB-00001071871",
    "BEMAWB-00001072680",
    "BEMAWB-00001080306",
    "BEMAWB-00001083387",
    "BEMAWB-00001083415",
    "BEMAWB-00001083626",
    "BEMAWB-00001083627",
    "BEMAWB-00001083648",
    "BEMAWB-00001083649",
    "BEMAWB-00001083654",
    "BEMAWB-00001083655",
]

HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "content-type": "application/x-www-form-urlencoded",
    "origin": BASE_URL,
    "pragma": "no-cache",
    "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
}

PAYLOAD_TEMPLATE = {
    "csrfmiddlewaretoken": CSRF_TOKEN,
    "order_status": "15",
    "cancel_reason": "Delete",
    "package_weight": "1.00",
    "package_width": "0",
    "package_length": "0",
    "package_height": "0",
    "pickup_address": "JL. Pulo Buaran Raya No. 4, Blok III EE - Kav. No.1, Jakarta, 13930, RW.9, Jatinegara, Cakung, East Jakarta City, Jakarta 13930",
    "pickup_postal_code": "12345",
    "pickup_lat": "-6.209309700",
    "pickup_long": "106.915178100",
    "dropoff_address": "JL. PONDASI BLOK S KAV. 36 NO. 27B, RT. 009 RW. 017 KEL. KAYU PUTIH, KEC. PULO GADUNG - JAKARTA TIMU",
    "dropoff_postal_code": "12345",
    "sender_name": "PT MERAPI UTAMA PHARMA - JK1",
    "sender_phone_number": "+62821660",
    "consignee_name": "300000500690937 - ALPRO PONDASI, AP.",
    "consignee_phone_number": "+62821660",
    "business_hub": "59",
    "_continue": "Save",
}


def delete_order(session, awb_number):
    order_id = awb_number.split("-")[-1].lstrip("0")
    url = f"{BASE_URL}/api/order/{order_id}/change/"

    headers = {**HEADERS, "referer": url}
    cookies = {
        "csrftoken": CSRF_TOKEN,
        "sessionid": SESSION_ID,
    }

    response = session.post(
        url,
        headers=headers,
        cookies=cookies,
        data=PAYLOAD_TEMPLATE,
        allow_redirects=False,
    )

    if response.status_code in (200, 302):
        print(f"[SUCCESS] {awb_number} -> Status: {response.status_code}")
    else:
        print(f"[FAILED]  {awb_number} -> Status: {response.status_code} | Response: {response.text[:200]}")


def main():
    session = requests.Session()

    for awb in AWB_NUMBERS:
        delete_order(session, awb)


if __name__ == "__main__":
    main()
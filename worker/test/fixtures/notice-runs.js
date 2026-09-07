/**
 * 실제 공지에서 뜬 항목의 **모양**. 글자는 지웠다.
 *
 * 위프코리아·포레스트애비뉴·제로백의 지금 공지를 훑어, 항목마다 rich_text 의
 * 서식·주석·색·링크·멘션 종류와 문장부호를 그대로 두고 낱말만 같은 길이의
 * 가짜 글자로 바꾼 것이다. 주소와 이모지 id 도 가짜로 갈았다. 같은 모양이
 * 다섯 번 넘게 나오면 거기서 끊었다.
 *
 * **왜 글자를 지웠나.** 레포 루트는 통째로 웹에 서빙된다. 공지 본문을 여기
 * 두면 그 순간 공개된다 — 봉투로 암호화해 두는 이유가 바로 그것이다.
 * 왕복이 무손실인지는 글자의 뜻이 아니라 모양이 정한다.
 *
 * 실제 분포: 텍스트 115 조각 · 멘션 10 조각 · 색 붙은 조각 4 · 링크 5.
 */
export const NOTICE_ITEMS = [
  {
    "type": "toggle",
    "rich_text": [
      {
        "type": "mention",
        "mention": {
          "type": "custom_emoji",
          "custom_emoji": {
            "id": "00000000-0000-0000-0000-000000000010",
            "name": "emoji10",
            "url": "https://example.com/emoji10.png"
          }
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ":0:",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나 다라마바 abcdefgh",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나 다라마바 abcdefgh",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라마",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라마",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마",
        "href": null
      }
    ]
  },
  {
    "type": "toggle",
    "rich_text": [
      {
        "type": "mention",
        "mention": {
          "type": "custom_emoji",
          "custom_emoji": {
            "id": "00000000-0000-0000-0000-000000000040",
            "name": "emoji40",
            "url": "https://example.com/emoji40.png"
          }
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ":0:",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나다라/마바사아 자차 카타 & 파하 거너 더러",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나다라/마바사아 자차 카타 & 파하 거너 더러",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라마",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라마",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마",
        "href": null
      }
    ]
  },
  {
    "type": "toggle",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "brown_background"
        },
        "plain_text": "가나다라",
        "href": null
      }
    ]
  },
  {
    "type": "toggle",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "brown_background"
        },
        "plain_text": "가나다라",
        "href": null
      }
    ]
  },
  {
    "type": "toggle",
    "rich_text": [
      {
        "type": "mention",
        "mention": {
          "type": "custom_emoji",
          "custom_emoji": {
            "id": "00000000-0000-0000-0000-000000000090",
            "name": "emoji90",
            "url": "https://example.com/emoji90.png"
          }
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ":0:",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나 다라 마바사아 ",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나 다라 마바사아 ",
        "href": null
      }
    ]
  },
  {
    "type": "quote",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "✅01가 나다라마 2바 사아자차카",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "✅01가 나다라마 2바 사아자차카",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라마, 바사아자차 카타파",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마, 바사아자차 카타파",
        "href": null
      }
    ]
  },
  {
    "type": "quote",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "✅01가 나다라 2마 바사아자차(34.56~78.90)",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "✅01가 나다라 2마 바사아자차(34.56~78.90)",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라마 ⇒ 바사아자 차카",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마 ⇒ 바사아자 차카",
        "href": null
      }
    ]
  },
  {
    "type": "quote",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "✅01가 나다라마바 사아자차(23.45~67.89)",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "✅01가 나다라마바 사아자차(23.45~67.89)",
        "href": null
      }
    ]
  },
  {
    "type": "quote",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "✅01가 나다라마바사아(23.45~67.89)",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "✅01가 나다라마바사아(23.45~67.89)",
        "href": null
      }
    ]
  },
  {
    "type": "toggle",
    "rich_text": [
      {
        "type": "mention",
        "mention": {
          "type": "custom_emoji",
          "custom_emoji": {
            "id": "00000000-0000-0000-0000-000000000160",
            "name": "emoji160",
            "url": "https://example.com/emoji160.png"
          }
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ":0:",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나 다 라마바사 ",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나 다 라마바사 ",
        "href": null
      }
    ]
  },
  {
    "type": "toggle",
    "rich_text": [
      {
        "type": "mention",
        "mention": {
          "type": "custom_emoji",
          "custom_emoji": {
            "id": "00000000-0000-0000-0000-000000000170",
            "name": "emoji170",
            "url": "https://example.com/emoji170.png"
          }
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ":0:",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나 다라 마바사아 ",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나 다라 마바사아 ",
        "href": null
      }
    ]
  },
  {
    "type": "toggle",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "brown_background"
        },
        "plain_text": "가나다라",
        "href": null
      }
    ]
  },
  {
    "type": "toggle",
    "rich_text": [
      {
        "type": "mention",
        "mention": {
          "type": "custom_emoji",
          "custom_emoji": {
            "id": "00000000-0000-0000-0000-000000000190",
            "name": "emoji190",
            "url": "https://example.com/emoji190.png"
          }
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ":0:",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나 다라 마바사아",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나 다라 마바사아",
        "href": null
      }
    ]
  },
  {
    "type": "toggle",
    "rich_text": [
      {
        "type": "mention",
        "mention": {
          "type": "custom_emoji",
          "custom_emoji": {
            "id": "00000000-0000-0000-0000-000000000200",
            "name": "emoji200",
            "url": "https://example.com/emoji200.png"
          }
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ":0:",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나 다라 마바사아",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나 다라 마바사아",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " : 가나다 라마바 사 아자 차카타 파하거 너더러 머버",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " : 가나다 라마바 사 아자 차카타 파하거 너더러 머버",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라 : ",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라 : ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "0가",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": true,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "0가",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " → 0가 ⇒ ",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " → 0가 ⇒ ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나다 라마바 a 01% 사아자차 ",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나다 라마바 a 01% 사아자차 ",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라마 abc (바사 de 아자) fgh (차카타 ij 파하거너더)",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나 다라마 abc (바사 de 아자) fgh (차카타 ij 파하거너더)",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라마 abc (바사아자차 de 카타파)",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나 다라마 abc (바사아자차 de 카타파)",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 abc 다라 def (마바사 gh 아자) ijk 차카",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나 abc 다라 def (마바사 gh 아자) ijk 차카",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 abc (마바 de 사아자) fgh (차카 ij 타)",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나 다라 abc (마바 de 사아자) fgh (차카 ij 타)",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 abc (마바사 de 아자차) fgh (카타파 ij 하거)",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나 다라 abc (마바사 de 아자차) fgh (카타파 ij 하거)",
        "href": null
      }
    ]
  },
  {
    "type": "paragraph",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "abcd 가나다(efghi://jk.lmno.pq.rs)라 tuvwxyzabc 마바 사아 자차카타 파하 거너 더러 머버. 서어 저처커터 퍼허 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "abcd 가나다(efghi://jk.lmno.pq.rs)라 tuvwxyzabc 마바 사아 자차카타 파하 거너 더러 머버. 서어 저처커터 퍼허 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나다.",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다.",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": ": 가나다라·마바사 → 아자차카타파 → 하거너더러머 버서",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ": 가나다라·마바사 → 아자차카타파 → 하거너더러머 버서",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": ": '가나' 다 라마, 바사 'a&b아자' 차 카타",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ": '가나' 다 라마, 바사 'a&b아자' 차 카타",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": ": '가나' 다라 (마바 사아자 차카)",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ": '가나' 다라 (마바 사아자 차카)",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": ": '가나다' 라마 '바사아자 차카타파'",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ": '가나다' 라마 '바사아자 차카타파'",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라 마바사아자 차카",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": true,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라 마바사아자 차카",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 → ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 → ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라마 바사 아자",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나 다라마 바사 아자",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 :",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 :",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나 다라마 바사 아자차 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나 다라마 바사 아자차 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바사",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나 다라 마바사",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "abcde ",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "abcde ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "abcde@fgh.ij.kl",
          "link": {
            "url": "mailto:pm@example.com"
          }
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "abcde@fgh.ij.kl",
        "href": "mailto:pm@example.com"
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 :",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나 다라 :",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나 다라마바",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": " 가나 다라마바",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 :",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 :",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바 사 아자 차카 -> 타파하 거너 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나 다라 마바 사 아자 차카 -> 타파하 거너 ",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바 사아 자차",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": true,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바 사아 자차",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "abc가 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "abc가 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나다라 마 바사 아자차 카타파 하 거너 더러",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라 마 바사 아자차 카타파 하 거너 더러",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라마·바사 아자 차 카타 파하거 너더",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라마·바사 아자 차 카타 파하거 너더",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바사 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바사 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바사 아자 차카 타파하 거너",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바사 아자 차카 타파하 거너",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다 라마바 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다 라마바 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나다라 마바 사아자차",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라 마바 사아자차",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나 다라 마바",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나 다라 마바",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 :",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 :",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " abcde-fghijkl mnopqrstu, 가나-다라 마바사. 아자 차카/타파하거너 더러 머버서어 저처커 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " abcde-fghijkl mnopqrstu, 가나-다라 마바사. 아자 차카/타파하거너 더러 머버서어 저처커 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나다 라마바",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다 라마바",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 :",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 :",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바 사아",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바 사아",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": ", ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ", ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나다 라",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다 라",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": ", ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ", ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라·마바 사아 자차카 타파",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라·마바 사아 자차카 타파",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바 :",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바 :",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나 다라마 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나 다라마 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바사 아자차",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바사 아자차",
        "href": null
      }
    ]
  },
  {
    "type": "paragraph",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라마",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "yellow_background"
        },
        "plain_text": "가나 다라마",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바 사아 자차 카타파 하거너 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바 사아 자차 카타파 하거너 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라마바 사아",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라마바 사아",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바사 아자차카타파 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바사 아자차카타파 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라마",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라마",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다 라마바사 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다 라마바사 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나다라·마바 사아자·차카타파 하거너",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라·마바 사아자·차카타파 하거너",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바 사아",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바 사아",
        "href": null
      }
    ]
  },
  {
    "type": "paragraph",
    "rich_text": [
      {
        "type": "mention",
        "mention": {
          "type": "link_mention",
          "link_mention": {
            "href": "https://example.com/card510"
          }
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "abcde://fghijkl.mn.op/?qrstuvw=xyzabcdefgh0ijkl1m2nopqrstuvwxyzabcdefghijk3lmnopqrstu-v",
        "href": "https://example.com/510"
      }
    ]
  },
  {
    "type": "numbered_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라 마바사아자차카타(a-파하) ",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라 마바사아자차카타(a-파하) ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "0/1(가) 23:45",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "0/1(가) 23:45",
        "href": null
      }
    ]
  },
  {
    "type": "numbered_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "a-가나다라 012 ",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "a-가나다라 012 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "0/12(가) 34:56",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "0/12(가) 34:56",
        "href": null
      }
    ]
  },
  {
    "type": "numbered_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라마바사(아자) ",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마바사(아자) ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "0/12(가) 34:56",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "0/12(가) 34:56",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라마 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 0다, 1라마 바사",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 0다, 1라마 바사",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "(가 나다 0.1라마 바사)",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "(가 나다 0.1라마 바사)",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다 라마 바사·아자차 0카 타파(",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다 라마 바사·아자차 0카 타파(",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "0가나다 라마",
          "link": null
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "0가나다 라마",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": ", 0가나다 라마바, 1사아자차, 2카타파하거너 더 러머버서",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ", 0가나다 라마바, 1사아자차, 2카타파하거너 더 러머버서",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "mention",
        "mention": {
          "type": "link_preview",
          "link_preview": {
            "href": "https://example.com/card570"
          }
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "abcde://fghi.jklmno.pqr/stuvwxyzabcd/e/0fghijklmnop1qrstuvwxyzabcdefghijklmnop2q3rs/tuvw?xyz=abcdefg",
        "href": "https://example.com/570"
      }
    ]
  },
  {
    "type": "paragraph",
    "rich_text": [
      {
        "type": "mention",
        "mention": {
          "type": "custom_emoji",
          "custom_emoji": {
            "id": "00000000-0000-0000-0000-000000000580",
            "name": "emoji580",
            "url": "https://example.com/emoji580.png"
          }
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": ":가나다:",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " ",
          "link": {
            "url": "https://example.com/581"
          }
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " ",
        "href": "https://example.com/581"
      },
      {
        "type": "text",
        "text": {
          "content": "가나다라마바사 아자차카타파",
          "link": {
            "url": "https://example.com/582"
          }
        },
        "annotations": {
          "bold": true,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마바사 아자차카타파",
        "href": "https://example.com/582"
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다 라마, 바사아 자차",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": true,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다 라마, 바사아 자차",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라 마 바사아자차 카타 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라 마 바사아자차 카타 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라마",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나 다라마",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다라마바 사아 자, 차 카타 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라마바 사아 자, 차 카타 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나다라 마바 사아 자차",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나다라 마바 사아 자차",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라마, 바사아자차 카타 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마, 바사아자차 카타 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나다 라마바사아",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나다 라마바사아",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나 다 라마바사 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다 라마바사 ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나다라마",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": true,
          "color": "default"
        },
        "plain_text": "가나다라마",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": " 가나",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": " 가나",
        "href": null
      }
    ]
  },
  {
    "type": "bulleted_list_item",
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "가나다라마바사(~0아) : ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나다라마바사(~0아) : ",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가나 다라 마바사",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": true,
          "code": false,
          "color": "default"
        },
        "plain_text": "가나 다라 마바사",
        "href": null
      },
      {
        "type": "text",
        "text": {
          "content": "가 나다 ",
          "link": null
        },
        "annotations": {
          "bold": false,
          "italic": false,
          "strikethrough": false,
          "underline": false,
          "code": false,
          "color": "default"
        },
        "plain_text": "가 나다 ",
        "href": null
      }
    ]
  }
];

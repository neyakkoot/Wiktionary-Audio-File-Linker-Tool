import pywikibot
from pywikibot import pagegenerators
import re

def process_wiktionary_audio():
    # தமிழ் விக்சனரி மற்றும் பொதுவகம் (Commons) அமைப்புகள்
    site_wiktionary = pywikibot.Site('ta', 'wiktionary')
    site_commons = pywikibot.Site('commons', 'commons')
    
    print("விக்சனரி சொற்கள் பட்டியலிடப்படுகின்றன...")
    
    # விக்சனரியில் உள்ள அனைத்துப் பக்கங்களையும் வரிசையாகப் படித்தல் (AllPages Generator)
    gen = pagegenerators.AllpagesPagegenerator(
        site=site_wiktionary,
        namespace=0,       # முதன்மைப் பெயர்வெளி (Main Namespace)
        includeredirects=False
    )
    
    count = 0
    updated_count = 0
    
    for page in gen:
        count += 1
        word = page.title()
        
        # தமிழ் சொற்களை மட்டும் தேர்வு செய்தல்
        if not re.search(r'[\u0B80-\u0BFF]', word):
            continue
            
        try:
            content = page.text
            
            # 1. ஏற்கனவே ஒலிப்புக் கோப்பு உள்ளதா எனச் சரிபார்த்தல்
            if '{{audio|' in content or '{{ஒலிப்பு}}' in content or '.ogg' in content or '.wav' in content:
                continue
                
            print(f"[{count}] ஒலிப்பு விடுபட்ட சொல்: {word}")
            
            # 2. விக்கிப் பொதுவகத்தில் (Commons) கோப்பு உள்ளதா எனத் தேடுதல்
            search_query = f'filetype:audio "{word}"'
            commons_search = site_commons.search(search_query, namespaces=[6], total=3)
            
            audio_file = None
            for file_item in commons_search:
                file_title = file_item.title(with_ns=False)
                # சொல் பெயர் கோப்புப் பெயரில் சரியாகப் பொருந்துகிறதா எனச் சரிபார்த்தல்
                if word.lower() in file_title.lower():
                    audio_file = file_title
                    break
            
            # 3. பொதுவகத்தில் கோப்பு இருந்தால் விக்சனரிப் பக்கத்தில் இணைத்துச் சேமித்தல்
            if audio_file:
                audio_wikitext = f"\n* {{audio|ta|{audio_file}|ஒலிப்பு}}\n"
                
                if '=== ஒலிப்பு ===' in content:
                    new_content = content.replace('=== ஒலிப்பு ===', f'=== ஒலிப்பு ==={audio_wikitext}')
                elif '=== பொருள் ===' in content:
                    new_content = content.replace('=== பொருள் ===', f'=== ஒலிப்பு ==={audio_wikitext}\n=== பொருள் ===')
                else:
                    new_content = audio_wikitext + content
                
                page.text = new_content
                summary = f"தானியங்கி கருவி: விக்கிப் பொதுவகத்திலிருந்து ஒலிப்புக் கோப்பு இணைக்கப்பட்டது: [[c:File:{audio_file}|{audio_file}]]"
                
                # பயனர் கணக்கில் சேமித்தல்
                page.save(summary=summary, botflag=False)
                updated_count += 1
                print(f"✅ வெற்றி: {word} பக்கத்தில் {audio_file} இணைக்கப்பட்டது!")
                
        except Exception as e:
            print(f"❌ பிழை ({word}): {e}")

if __name__ == "__main__":
    process_wiktionary_audio()

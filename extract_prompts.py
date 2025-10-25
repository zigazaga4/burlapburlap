#!/usr/bin/env python3
"""
Extract system prompts from defense_lawyer_client.py for use in the testing agents system.
This script parses the Python file and extracts the system prompts for:
- Case AI (UK, USA, CANADA)
- Home Chat AI (UK, USA, CANADA)
"""

import re
import json
from pathlib import Path

def extract_prompts_from_file(file_path):
    """Extract all system prompts from the defense_lawyer_client.py file."""
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    prompts = {}
    
    # Extract Home Screen prompts for each country
    # UK Home Screen
    uk_home_match = re.search(
        r'else:\s+base_instructions = add_current_datetime_to_prompt\("""(.*?)"""\)\s+logger\.info\(f"\[CHAT_SYSTEM_PROMPT\] Using UK home screen instructions',
        content,
        re.DOTALL
    )
    if uk_home_match:
        prompts['home_chat_uk'] = uk_home_match.group(1).strip()
    
    # USA Home Screen
    usa_home_match = re.search(
        r'if user_country == \'USA\':\s+base_instructions = add_current_datetime_to_prompt\("""(.*?)"""\)\s+logger\.info\(f"\[CHAT_SYSTEM_PROMPT\] Using USA home screen instructions',
        content,
        re.DOTALL
    )
    if usa_home_match:
        prompts['home_chat_usa'] = usa_home_match.group(1).strip()
    
    # CANADA Home Screen
    canada_home_match = re.search(
        r'elif user_country == \'CANADA\':\s+base_instructions = add_current_datetime_to_prompt\("""(.*?)"""\)\s+logger\.info\(f"\[CHAT_SYSTEM_PROMPT\] Using CANADA home screen instructions',
        content,
        re.DOTALL
    )
    if canada_home_match:
        prompts['home_chat_canada'] = canada_home_match.group(1).strip()
    
    # Extract Case AI prompts (using UNIFIED_SYSTEM_PROMPT variables)
    # UK Case AI
    uk_case_match = re.search(
        r'UNIFIED_SYSTEM_PROMPT = """(.*?)"""',
        content,
        re.DOTALL
    )
    if uk_case_match:
        prompts['case_ai_uk'] = uk_case_match.group(1).strip()
    
    # USA Case AI
    usa_case_match = re.search(
        r'UNIFIED_SYSTEM_PROMPT_USA = """(.*?)"""',
        content,
        re.DOTALL
    )
    if usa_case_match:
        prompts['case_ai_usa'] = usa_case_match.group(1).strip()
    
    # CANADA Case AI
    canada_case_match = re.search(
        r'UNIFIED_SYSTEM_PROMPT_CANADA = """(.*?)"""',
        content,
        re.DOTALL
    )
    if canada_case_match:
        prompts['case_ai_canada'] = canada_case_match.group(1).strip()
    
    return prompts

def main():
    # Path to the defense_lawyer_client.py file
    source_file = Path(__file__).parent.parent / 'MPC_server' / 'server' / 'defense_lawyer' / 'defense_lawyer_client.py'
    
    if not source_file.exists():
        print(f"Error: Source file not found at {source_file}")
        return
    
    print(f"Extracting prompts from {source_file}...")
    prompts = extract_prompts_from_file(source_file)
    
    # Save to JSON file
    output_file = Path(__file__).parent / 'backend' / 'lawyer_prompts.json'
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(prompts, f, indent=2, ensure_ascii=False)
    
    print(f"\nExtracted {len(prompts)} prompts:")
    for key in prompts.keys():
        prompt_preview = prompts[key][:100].replace('\n', ' ')
        print(f"  - {key}: {len(prompts[key])} chars ({prompt_preview}...)")
    
    print(f"\nSaved to {output_file}")

if __name__ == '__main__':
    main()

